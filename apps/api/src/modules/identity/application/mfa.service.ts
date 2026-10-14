import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import {
  ConflictError,
  UnauthorizedError,
  UnprocessableError,
} from '../../../core/errors/problems.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  randomToken,
  sha256Hex,
} from '../domain/secrets.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../domain/totp.js';
import { IdentityRepository, type UserRecord } from '../infrastructure/identity.repository.js';
import { AuthAudit } from './auth-audit.js';

const CHALLENGE_TTL_SECONDS = 300;
const MAX_CHALLENGE_ATTEMPTS = 5;

interface Challenge {
  userId: string;
  tenantId: string;
  method: string;
  amr: string[];
  attempts: number;
}

/** MFA por TOTP com códigos de recuperação e desafio de login de curta duração. */
@Injectable()
export class MfaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repository: IdentityRepository,
    private readonly audit: AuthAudit,
  ) {}

  /** Gera um segredo pendente (só vale após confirmação com um código). */
  async setup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.user(userId);
    if (user.mfaEnabled) throw new ConflictError('O MFA já está ativo.', 'mfa_already_enabled');
    const secret = generateTotpSecret();
    await this.repository.updateUser(userId, {
      mfaPendingSecretCiphertext: encryptSecret(secret, this.config.ENCRYPTION_KEY),
    });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  async enable(
    userId: string,
    tenantId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.user(userId);
    if (user.mfaPendingSecretCiphertext === null)
      throw new UnprocessableError('Inicie a configuração do MFA primeiro.', 'mfa_setup_required');
    const secret = decryptSecret(user.mfaPendingSecretCiphertext, this.config.ENCRYPTION_KEY);
    const step = verifyTotp(secret, code);
    if (step === null) throw new UnauthorizedError('mfa_invalid_code', 'Código inválido.');
    await this.markStepUsed(userId, step);
    const recoveryCodes = generateRecoveryCodes();
    await this.repository.updateUser(userId, {
      mfaEnabled: true,
      mfaSecretCiphertext: user.mfaPendingSecretCiphertext,
      mfaPendingSecretCiphertext: null,
      mfaRecoveryCodeHashes: recoveryCodes.map((entry) => sha256Hex(normalizeRecoveryCode(entry))),
    });
    await this.audit.record(tenantId, userId, 'auth.mfa_enabled', 'user', userId);
    return { recoveryCodes };
  }

  async disable(userId: string, tenantId: string, code: string): Promise<void> {
    const user = await this.user(userId);
    if (!user.mfaEnabled) throw new UnprocessableError('O MFA não está ativo.', 'mfa_not_enabled');
    await this.verifySecondFactor(user, code, undefined);
    await this.repository.updateUser(userId, {
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      mfaPendingSecretCiphertext: null,
      mfaRecoveryCodeHashes: [],
    });
    await this.audit.record(tenantId, userId, 'auth.mfa_disabled', 'user', userId);
  }

  async regenerateRecoveryCodes(
    userId: string,
    tenantId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.user(userId);
    if (!user.mfaEnabled) throw new UnprocessableError('O MFA não está ativo.', 'mfa_not_enabled');
    await this.verifySecondFactor(user, code, undefined);
    const recoveryCodes = generateRecoveryCodes();
    await this.repository.updateUser(userId, {
      mfaRecoveryCodeHashes: recoveryCodes.map((entry) => sha256Hex(normalizeRecoveryCode(entry))),
    });
    await this.audit.record(
      tenantId,
      userId,
      'auth.mfa_recovery_codes_regenerated',
      'user',
      userId,
    );
    return { recoveryCodes };
  }

  async createChallenge(
    userId: string,
    tenantId: string,
    method: string,
    amr: string[],
  ): Promise<{ challengeToken: string; expiresIn: number }> {
    const challengeToken = randomToken();
    const challenge: Challenge = { userId, tenantId, method, amr, attempts: 0 };
    await this.redis.set(
      this.challengeKey(challengeToken),
      JSON.stringify(challenge),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return { challengeToken, expiresIn: CHALLENGE_TTL_SECONDS };
  }

  async verifyChallenge(
    challengeToken: string,
    code: string | undefined,
    recoveryCode: string | undefined,
  ): Promise<Challenge> {
    const key = this.challengeKey(challengeToken);
    const raw = await this.redis.get(key);
    if (raw === null)
      throw new UnauthorizedError('mfa_challenge_invalid', 'Desafio expirado. Entre novamente.');
    const challenge = JSON.parse(raw) as Challenge;
    const user = await this.user(challenge.userId);
    try {
      await this.verifySecondFactor(user, code, recoveryCode);
    } catch (error) {
      challenge.attempts += 1;
      if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) await this.redis.del(key);
      else await this.redis.set(key, JSON.stringify(challenge), 'KEEPTTL');
      throw error;
    }
    await this.redis.del(key);
    return challenge;
  }

  private async verifySecondFactor(
    user: UserRecord,
    code: string | undefined,
    recoveryCode: string | undefined,
  ): Promise<void> {
    if (recoveryCode !== undefined) {
      const hash = sha256Hex(normalizeRecoveryCode(recoveryCode));
      if (!user.mfaRecoveryCodeHashes.includes(hash))
        throw new UnauthorizedError('mfa_invalid_code', 'Código de recuperação inválido.');
      await this.repository.updateUser(user.id, {
        mfaRecoveryCodeHashes: user.mfaRecoveryCodeHashes.filter((entry) => entry !== hash),
      });
      return;
    }
    if (code === undefined || user.mfaSecretCiphertext === null)
      throw new UnauthorizedError('mfa_invalid_code', 'Código inválido.');
    const step = verifyTotp(
      decryptSecret(user.mfaSecretCiphertext, this.config.ENCRYPTION_KEY),
      code,
    );
    if (step === null || !(await this.markStepUsed(user.id, step)))
      throw new UnauthorizedError('mfa_invalid_code', 'Código inválido.');
  }

  /** Impede reutilização do mesmo código TOTP (replay) dentro da janela. */
  private async markStepUsed(userId: string, step: number): Promise<boolean> {
    const result = await this.redis.set(`mfa:used:${userId}:${step}`, '1', 'EX', 120, 'NX');
    return result === 'OK';
  }

  private challengeKey(token: string): string {
    return `mfa:challenge:${sha256Hex(token)}`;
  }

  private async user(userId: string): Promise<UserRecord> {
    const user = await this.repository.findUserById(userId);
    if (user === null) throw new UnauthorizedError();
    return user;
  }
}
