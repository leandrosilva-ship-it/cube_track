import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@cube-track/shared';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { TokenService } from '../../../core/auth/token.service.js';
import { currentContext } from '../../../core/context/request-context.js';
import { ForbiddenError, UnauthorizedError } from '../../../core/errors/problems.js';
import { randomToken, sha256Hex } from '../domain/secrets.js';
import {
  IdentityRepository,
  type MembershipSummary,
  type UserRecord,
} from '../infrastructure/identity.repository.js';
import { AuthAudit } from './auth-audit.js';

export interface IssuedSession {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
  tenant: { id: string; slug: string; name: string; kind: 'member' | 'guest'; roleKey: string };
}

export interface IssueInput {
  user: UserRecord;
  membership: MembershipSummary;
  method: 'password' | 'magic_link' | 'oauth' | 'invitation' | 'signup' | 'refresh' | 'switch';
  amr: string[];
  familyId?: string;
}

/** Sessões com refresh token rotativo e detecção de reutilização por família (ADR 0026). */
@Injectable()
export class SessionService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repository: IdentityRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuthAudit,
  ) {}

  async issue(input: IssueInput): Promise<IssuedSession> {
    const context = currentContext();
    const refreshToken = randomToken(48);
    const refreshExpiresAt = new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const session = await this.repository.createSession({
      tenantId: input.membership.tenantId,
      userId: input.user.id,
      familyId: input.familyId ?? newId(),
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: refreshExpiresAt,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
      mfaVerified: input.amr.includes('otp'),
      authMethod: input.method,
    });
    const accessToken = await this.tokens.signAccessToken({
      userId: input.user.id,
      tenantId: input.membership.tenantId,
      sessionId: session.id,
      kind: input.membership.kind,
      amr: input.amr,
    });
    if (input.method !== 'refresh') {
      await this.repository.updateUser(input.user.id, {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      });
    }
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTokenTtlSeconds,
      refreshToken,
      refreshExpiresAt,
      sessionId: session.id,
      user: {
        id: input.user.id,
        email: input.user.email,
        name: input.user.name,
        mfaEnabled: input.user.mfaEnabled,
      },
      tenant: {
        id: input.membership.tenantId,
        slug: input.membership.tenantSlug,
        name: input.membership.tenantName,
        kind: input.membership.kind,
        roleKey: input.membership.roleKey,
      },
    };
  }

  /**
   * Rotaciona o refresh token. Apresentar um token já rotacionado indica roubo: toda a família é
   * revogada e o usuário precisa autenticar de novo.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const session = await this.repository.findSessionByTokenHash(sha256Hex(refreshToken));
    if (session === null) throw new UnauthorizedError('refresh_invalid', 'Sessão inválida.');
    if (session.revokedAt !== null) {
      if (session.revokedReason === 'rotated') {
        const revoked = await this.repository.revokeFamily(session.familyId, 'reuse_detected');
        await this.audit.record(
          session.tenantId,
          session.userId,
          'auth.refresh_reuse_detected',
          'session',
          session.id,
          {
            familyId: session.familyId,
          },
        );
        await this.audit.sessionsRevoked(revoked);
        throw new UnauthorizedError(
          'refresh_reused',
          'Sessão encerrada por segurança. Entre novamente.',
        );
      }
      throw new UnauthorizedError('refresh_revoked', 'Sessão encerrada.');
    }
    if (session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedError('refresh_expired', 'Sessão expirada.');
    const user = await this.repository.findUserById(session.userId);
    if (user?.status !== 'active') throw new UnauthorizedError('user_inactive', 'Usuário inativo.');
    const membership = await this.repository.findMembership(user.id, session.tenantId);
    if (membership === null)
      throw new UnauthorizedError(
        'membership_inactive',
        'Você não participa mais desta organização.',
      );
    const issued = await this.issue({
      user,
      membership,
      method: 'refresh',
      amr: session.mfaVerified ? ['pwd', 'otp'] : ['pwd'],
      familyId: session.familyId,
    });
    const rotated = await this.repository.markRotated(session.id, issued.sessionId);
    if (!rotated) {
      // Corrida: outra requisição rotacionou primeiro — trata como reutilização.
      await this.repository.deleteSession(issued.sessionId);
      const revoked = await this.repository.revokeFamily(session.familyId, 'reuse_detected');
      await this.audit.sessionsRevoked(revoked);
      throw new UnauthorizedError(
        'refresh_reused',
        'Sessão encerrada por segurança. Entre novamente.',
      );
    }
    return issued;
  }

  /** Encerra a sessão (e sua família de rotação). */
  async revoke(sessionId: string, reason: string): Promise<void> {
    const session = await this.repository.findSession(sessionId);
    if (session === null) return;
    const revoked = await this.repository.revokeFamily(session.familyId, reason);
    await this.audit.record(
      session.tenantId,
      session.userId,
      'auth.logout',
      'session',
      session.id,
      { reason },
    );
    await this.audit.sessionsRevoked(revoked);
  }

  async revokeByRefreshToken(refreshToken: string, reason: string): Promise<void> {
    const session = await this.repository.findSessionByTokenHash(sha256Hex(refreshToken));
    if (session !== null) await this.revoke(session.id, reason);
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    const revoked = await this.repository.revokeAllForUser(userId, reason);
    await this.audit.sessionsRevoked(revoked);
  }

  /** Troca de organização: emite sessão no tenant de destino e encerra a atual. */
  async switchTenant(
    userId: string,
    currentSessionId: string,
    targetTenantId: string,
  ): Promise<IssuedSession> {
    const user = await this.repository.findUserById(userId);
    if (user?.status !== 'active') throw new UnauthorizedError('user_inactive', 'Usuário inativo.');
    const membership = await this.repository.findMembership(userId, targetTenantId);
    if (membership === null)
      throw new ForbiddenError('Você não participa desta organização.', 'not_a_member');
    const current = await this.repository.findSession(currentSessionId);
    const issued = await this.issue({
      user,
      membership,
      method: 'switch',
      amr: current?.mfaVerified === true ? ['pwd', 'otp'] : ['pwd'],
    });
    await this.revoke(currentSessionId, 'switched_tenant');
    await this.audit.record(
      targetTenantId,
      userId,
      'auth.switch_tenant',
      'session',
      issued.sessionId,
      {
        fromTenantId: current?.tenantId ?? null,
      },
    );
    return issued;
  }
}
