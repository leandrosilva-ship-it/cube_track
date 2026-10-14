import { Inject, Injectable } from '@nestjs/common';
import { provisionTenant, schema } from '@cube-track/db';
import { initialPositions, newId, QUEUES, type EmailJob } from '@cube-track/shared';
import type { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { currentContext, type ResolvedTenant } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../../core/queues/queues.module.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../domain/password.js';
import { randomToken, sha256Hex } from '../domain/secrets.js';
import {
  IdentityRepository,
  type MembershipSummary,
  type UserRecord,
} from '../infrastructure/identity.repository.js';
import { OAuthClient, type OAuthProviderName } from '../infrastructure/oauth.client.js';
import { AuthAudit } from './auth-audit.js';
import { MfaService } from './mfa.service.js';
import { SessionService, type IssuedSession } from './session.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MAGIC_LINK_TTL_MS = 15 * 60_000;
const PASSWORD_RESET_TTL_MS = 60 * 60_000;
const EMAIL_VERIFICATION_TTL_MS = 48 * 3_600_000;
const OAUTH_STATE_TTL_SECONDS = 600;

export type LoginResult =
  | { kind: 'session'; session: IssuedSession }
  | { kind: 'mfa'; challengeToken: string; expiresIn: number };

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug: string;
}

interface OAuthState {
  provider: OAuthProviderName;
  codeVerifier: string;
  nonce: string;
  tenantRef: string | null;
}

/** Fluxos de autenticação (senha, magic link, OAuth, redefinição de senha, verificação de e-mail). */
@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    private readonly repository: IdentityRepository,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly oauth: OAuthClient,
    private readonly runner: TransactionRunner,
    private readonly events: DomainEvents,
    private readonly audit: AuthAudit,
  ) {}

  // ----------------------------------------------------------------------------- cadastro ---

  /** Cria usuário + organização (com papéis, calendário e workspace inicial) e abre a sessão. */
  async signup(input: SignupInput): Promise<IssuedSession> {
    const policy = checkPasswordPolicy(input.password, input.email);
    if (!policy.ok)
      throw new ValidationError(
        policy.reasons.map((message) => ({ path: 'body.password', message })),
      );
    if ((await this.repository.findUserByEmail(input.email)) !== null) {
      throw new ConflictError(
        'Já existe uma conta com este e-mail. Entre ou recupere a senha.',
        'email_in_use',
      );
    }
    const slug = input.organizationSlug.toLowerCase();
    const user = await this.repository.createUser({
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      emailVerified: false,
    });
    const tenantId = newId();
    try {
      await this.runner.run({ tenantId, userId: user.id }, async () => {
        const tx = this.runner.tx;
        const provisioned = await provisionTenant(tx, {
          id: tenantId,
          name: input.organizationName,
          slug,
          createdBy: user.id,
        });
        await tx.insert(schema.memberships).values({
          tenantId,
          userId: user.id,
          roleId: provisioned.roleIds.owner ?? '',
          kind: 'member',
          status: 'active',
          joinedAt: new Date(),
          createdBy: user.id,
        });
        await tx.insert(schema.workspaces).values({
          tenantId,
          name: 'Área de trabalho principal',
          position: initialPositions(1)[0] ?? 'a0',
          createdBy: user.id,
        });
        this.events.recordChange({
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: tenantId,
          after: { name: input.organizationName, slug },
        });
        this.events.recordChange({
          action: 'auth.signup',
          entityType: 'user',
          entityId: user.id,
          after: { email: user.email },
        });
      });
    } catch (error) {
      // Organização não criada (ex.: slug em uso): desfaz o usuário recém-criado.
      await this.repository.updateUser(user.id, {
        status: 'anonymized',
        email: `removed+${user.id}@invalid.local`,
        passwordHash: null,
      });
      throw error;
    }
    await this.sendEmailVerification(user, tenantId);
    const membership = await this.membershipOrThrow(user, null, tenantId);
    return this.sessions.issue({ user, membership, method: 'signup', amr: ['pwd'] });
  }

  // -------------------------------------------------------------------------------- senha ---

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.repository.findUserByEmail(email);
    const valid = await verifyPassword(user?.passwordHash ?? null, password);
    if (user === null) {
      this.audit.securityLog('auth.login_failed', {
        reason: 'unknown_email',
        ip: currentContext()?.ip,
      });
      throw new UnauthorizedError('invalid_credentials', 'E-mail ou senha incorretos.');
    }
    if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
      throw new AppError(
        423,
        'account_locked',
        'Conta bloqueada',
        'Conta temporariamente bloqueada por tentativas inválidas. Tente mais tarde ou redefina a senha.',
      );
    }
    if (!valid) {
      await this.repository.registerFailedLogin(user.id, MAX_FAILED_LOGINS, LOCK_MINUTES);
      this.audit.securityLog('auth.login_failed', {
        reason: 'bad_password',
        userId: user.id,
        ip: currentContext()?.ip,
      });
      throw new UnauthorizedError('invalid_credentials', 'E-mail ou senha incorretos.');
    }
    return this.completePrimaryAuthentication(user, 'password', ['pwd']);
  }

  /** Após o 1º fator: exige MFA (se ativo) ou emite a sessão. */
  private async completePrimaryAuthentication(
    user: UserRecord,
    method: 'password' | 'magic_link' | 'oauth',
    amr: string[],
    preferredTenantId: string | null = null,
  ): Promise<LoginResult> {
    if (user.status !== 'active') throw new ForbiddenError('Usuário inativo.', 'user_inactive');
    const membership = await this.membershipOrThrow(
      user,
      currentContext()?.tenant ?? null,
      preferredTenantId,
    );
    if (user.mfaEnabled) {
      const challenge = await this.mfa.createChallenge(user.id, membership.tenantId, method, amr);
      return { kind: 'mfa', ...challenge };
    }
    const session = await this.sessions.issue({ user, membership, method, amr });
    await this.audit.record(
      membership.tenantId,
      user.id,
      'auth.login',
      'session',
      session.sessionId,
      { method },
    );
    return { kind: 'session', session };
  }

  /** Conclui o login com o 2º fator. */
  async completeMfa(
    challengeToken: string,
    code: string | undefined,
    recoveryCode: string | undefined,
  ): Promise<IssuedSession> {
    const challenge = await this.mfa.verifyChallenge(challengeToken, code, recoveryCode);
    const user = await this.repository.findUserById(challenge.userId);
    if (user?.status !== 'active') throw new UnauthorizedError('user_inactive', 'Usuário inativo.');
    const membership = await this.membershipOrThrow(user, null, challenge.tenantId);
    const session = await this.sessions.issue({
      user,
      membership,
      method: challenge.method as 'password',
      amr: [...challenge.amr, 'otp'],
    });
    await this.audit.record(
      membership.tenantId,
      user.id,
      'auth.login',
      'session',
      session.sessionId,
      {
        method: challenge.method,
        mfa: recoveryCode === undefined ? 'totp' : 'recovery_code',
      },
    );
    return session;
  }

  // --------------------------------------------------------------------------- magic link ---

  /** Sempre responde 202 (não revela se o e-mail existe). */
  async requestMagicLink(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    if (user?.status !== 'active') return;
    const memberships = await this.repository.listMemberships(user.id);
    const tenant = currentContext()?.tenant ?? null;
    const target =
      tenant === null
        ? memberships[0]
        : memberships.find((entry) => entry.tenantId === tenant.tenantId);
    if (target === undefined) return;
    const token = randomToken();
    await this.repository.invalidateAuthTokens(user.id, 'magic_link');
    await this.repository.createAuthToken({
      userId: user.id,
      tenantId: target.tenantId,
      purpose: 'magic_link',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      ip: currentContext()?.ip ?? null,
    });
    await this.sendEmail({
      to: user.email,
      template: 'magic_link',
      locale: user.locale,
      data: {
        name: user.name,
        organization: target.tenantName,
        link: `${this.config.APP_URL}/auth/magic-link?token=${token}`,
        expiresInMinutes: '15',
      },
    });
  }

  async verifyMagicLink(token: string): Promise<LoginResult> {
    const record = await this.repository.consumeAuthToken(sha256Hex(token), 'magic_link');
    if (record === null) throw new UnauthorizedError('link_invalid', 'Link inválido ou expirado.');
    const user = await this.repository.findUserById(record.userId);
    if (user === null) throw new UnauthorizedError('link_invalid', 'Link inválido ou expirado.');
    if (user.emailVerifiedAt === null)
      await this.repository.updateUser(user.id, { emailVerifiedAt: new Date() });
    return this.completePrimaryAuthentication(user, 'magic_link', ['email'], record.tenantId);
  }

  // ------------------------------------------------------------------- recuperação de senha ---

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    if (user?.status !== 'active') return;
    const memberships = await this.repository.listMemberships(user.id);
    const token = randomToken();
    await this.repository.invalidateAuthTokens(user.id, 'password_reset');
    await this.repository.createAuthToken({
      userId: user.id,
      tenantId: memberships[0]?.tenantId ?? null,
      purpose: 'password_reset',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      ip: currentContext()?.ip ?? null,
    });
    await this.sendEmail({
      to: user.email,
      template: 'password_reset',
      locale: user.locale,
      data: {
        name: user.name,
        link: `${this.config.APP_URL}/auth/reset-password?token=${token}`,
        expiresInMinutes: '60',
      },
    });
  }

  /** Define nova senha, desbloqueia a conta e encerra todas as sessões. */
  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.repository.consumeAuthToken(sha256Hex(token), 'password_reset');
    if (record === null) throw new UnauthorizedError('link_invalid', 'Link inválido ou expirado.');
    const user = await this.repository.findUserById(record.userId);
    if (user === null) throw new UnauthorizedError('link_invalid', 'Link inválido ou expirado.');
    const policy = checkPasswordPolicy(password, user.email);
    if (!policy.ok)
      throw new ValidationError(
        policy.reasons.map((message) => ({ path: 'body.password', message })),
      );
    await this.repository.updateUser(user.id, {
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    });
    await this.sessions.revokeAllForUser(user.id, 'password_reset');
    for (const membership of await this.repository.listMemberships(user.id)) {
      await this.audit.record(membership.tenantId, user.id, 'auth.password_reset', 'user', user.id);
    }
  }

  async changePassword(
    userId: string,
    tenantId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.repository.findUserById(userId);
    if (user === null || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new UnauthorizedError('invalid_credentials', 'Senha atual incorreta.');
    }
    const policy = checkPasswordPolicy(newPassword, user.email);
    if (!policy.ok)
      throw new ValidationError(
        policy.reasons.map((message) => ({ path: 'body.newPassword', message })),
      );
    await this.repository.updateUser(user.id, {
      passwordHash: await hashPassword(newPassword),
      passwordChangedAt: new Date(),
    });
    await this.audit.record(tenantId, user.id, 'auth.password_changed', 'user', user.id);
  }

  // ------------------------------------------------------------------ verificação de e-mail ---

  async sendEmailVerification(user: UserRecord, tenantId: string | null): Promise<void> {
    const token = randomToken();
    await this.repository.createAuthToken({
      userId: user.id,
      tenantId,
      purpose: 'email_verification',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      ip: currentContext()?.ip ?? null,
    });
    await this.sendEmail({
      to: user.email,
      template: 'email_verification',
      locale: user.locale,
      data: { name: user.name, link: `${this.config.APP_URL}/auth/verify-email?token=${token}` },
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.repository.consumeAuthToken(sha256Hex(token), 'email_verification');
    if (record === null) throw new UnauthorizedError('link_invalid', 'Link inválido ou expirado.');
    await this.repository.updateUser(record.userId, { emailVerifiedAt: new Date() });
    if (record.tenantId !== null)
      await this.audit.record(
        record.tenantId,
        record.userId,
        'auth.email_verified',
        'user',
        record.userId,
      );
  }

  // -------------------------------------------------------------------------------- OAuth ---

  async startOAuth(
    provider: OAuthProviderName,
    tenant: ResolvedTenant | null,
    loginHint?: string,
  ): Promise<string> {
    const state = randomToken(24);
    const stored: OAuthState = {
      provider,
      codeVerifier: randomToken(48),
      nonce: randomToken(24),
      tenantRef: tenant?.tenantId ?? null,
    };
    const url = this.oauth.authorizationUrl(provider, {
      state,
      nonce: stored.nonce,
      codeVerifier: stored.codeVerifier,
      ...(loginHint === undefined ? {} : { loginHint }),
    });
    await this.redis.set(
      `oauth:state:${state}`,
      JSON.stringify(stored),
      'EX',
      OAUTH_STATE_TTL_SECONDS,
    );
    return url;
  }

  /**
   * Callback OAuth: vincula a identidade externa a um usuário existente (pelo e-mail verificado)
   * ou cria o usuário quando há convite pendente. Sem conta nem convite, o acesso é negado.
   */
  async completeOAuth(
    provider: OAuthProviderName,
    code: string,
    state: string,
  ): Promise<LoginResult> {
    const raw = await this.redis.getdel(`oauth:state:${state}`);
    if (raw === null)
      throw new UnauthorizedError(
        'oauth_state_invalid',
        'Sessão de login expirada. Tente novamente.',
      );
    const stored = JSON.parse(raw) as OAuthState;
    if (stored.provider !== provider)
      throw new UnauthorizedError('oauth_state_invalid', 'Sessão de login inválida.');
    const identity = await this.oauth.exchange(provider, code, stored.codeVerifier, stored.nonce);

    let user: UserRecord | null = null;
    const linked = await this.repository.findIdentity(provider, identity.subject);
    if (linked !== null) user = await this.repository.findUserById(linked.userId);
    if (user === null) {
      if (!identity.emailVerified)
        throw new ForbiddenError(
          'O e-mail não foi verificado pelo provedor.',
          'oauth_email_unverified',
        );
      user = await this.repository.findUserByEmail(identity.email);
      if (user === null) {
        const invitation = await this.repository.findPendingInvitationByEmail(
          identity.email,
          stored.tenantRef,
        );
        if (invitation === null)
          throw new ForbiddenError('Não há conta nem convite para este e-mail.', 'no_account');
        user = await this.repository.createUser({
          email: identity.email,
          name: identity.name ?? identity.email,
          passwordHash: null,
          emailVerified: true,
        });
      }
      await this.repository.linkIdentity(user.id, provider, identity.subject, identity.email);
    } else {
      await this.repository.linkIdentity(user.id, provider, identity.subject, identity.email);
    }
    if (user.emailVerifiedAt === null && identity.emailVerified)
      await this.repository.updateUser(user.id, { emailVerifiedAt: new Date() });
    return this.completePrimaryAuthentication(user, 'oauth', ['oauth', provider], stored.tenantRef);
  }

  // ----------------------------------------------------------------------------- utilitários ---

  async organizations(userId: string): Promise<MembershipSummary[]> {
    return this.repository.listMemberships(userId);
  }

  async membershipOrThrow(
    user: UserRecord,
    tenant: ResolvedTenant | null,
    preferredTenantId: string | null,
  ): Promise<MembershipSummary> {
    const memberships = await this.repository.listMemberships(user.id);
    const targetId = tenant?.tenantId ?? preferredTenantId;
    if (targetId !== null) {
      const match = memberships.find((entry) => entry.tenantId === targetId);
      if (match === undefined)
        throw new ForbiddenError('Você não participa desta organização.', 'not_a_member');
      return match;
    }
    const first = memberships[0];
    if (first === undefined)
      throw new ForbiddenError(
        'Sua conta não está vinculada a nenhuma organização.',
        'no_organization',
      );
    return first;
  }

  async sendEmail(job: EmailJob): Promise<void> {
    await this.queues[QUEUES.emails].add(job.template, job);
  }
}
