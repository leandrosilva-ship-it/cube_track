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
  type SessionRecord,
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
   * revogada e o usuário precisa autenticar de novo — exceto dentro da janela de tolerância, quando o
   * sucessor ainda não foi usado (a resposta da rotação se perdeu): a sessão é reemitida.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const session = await this.repository.findSessionByTokenHash(sha256Hex(refreshToken));
    if (session === null) throw new UnauthorizedError('refresh_invalid', 'Sessão inválida.');
    if (session.revokedAt !== null) {
      if (session.revokedReason === 'rotated') {
        if (this.withinReuseGrace(session)) {
          const reissued = await this.reissueLostRotation(session);
          if (reissued !== null) return reissued;
        }
        await this.reuseDetected(session);
      }
      throw new UnauthorizedError('refresh_revoked', 'Sessão encerrada.');
    }
    if (session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedError('refresh_expired', 'Sessão expirada.');
    const issued = await this.issueForRefresh(session);
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

  private withinReuseGrace(session: SessionRecord): boolean {
    const graceMs = this.config.REFRESH_REUSE_GRACE_SECONDS * 1000;
    return (
      graceMs > 0 &&
      session.replacedById !== null &&
      session.revokedAt !== null &&
      Date.now() - session.revokedAt.getTime() <= graceMs &&
      session.expiresAt.getTime() > Date.now()
    );
  }

  /** Reemite a sessão quando o sucessor nunca foi usado; null se ele já circulou (reutilização). */
  private async reissueLostRotation(session: SessionRecord): Promise<IssuedSession | null> {
    if (session.replacedById === null) return null;
    const issued = await this.issueForRefresh(session);
    const superseded = await this.repository.supersedeUnusedSuccessor(
      session.replacedById,
      issued.sessionId,
    );
    if (!superseded) {
      await this.repository.deleteSession(issued.sessionId);
      return null;
    }
    await this.audit.record(
      session.tenantId,
      session.userId,
      'auth.refresh_reissued',
      'session',
      issued.sessionId,
      { familyId: session.familyId, supersededSessionId: session.replacedById },
    );
    return issued;
  }

  private async reuseDetected(session: SessionRecord): Promise<never> {
    const revoked = await this.repository.revokeFamily(session.familyId, 'reuse_detected');
    await this.audit.record(
      session.tenantId,
      session.userId,
      'auth.refresh_reuse_detected',
      'session',
      session.id,
      { familyId: session.familyId },
    );
    await this.audit.sessionsRevoked(revoked);
    throw new UnauthorizedError(
      'refresh_reused',
      'Sessão encerrada por segurança. Entre novamente.',
    );
  }

  private async issueForRefresh(session: SessionRecord): Promise<IssuedSession> {
    const user = await this.repository.findUserById(session.userId);
    if (user?.status !== 'active') throw new UnauthorizedError('user_inactive', 'Usuário inativo.');
    const membership = await this.repository.findMembership(user.id, session.tenantId);
    if (membership === null)
      throw new UnauthorizedError(
        'membership_inactive',
        'Você não participa mais desta organização.',
      );
    return this.issue({
      user,
      membership,
      method: 'refresh',
      amr: session.mfaVerified ? ['pwd', 'otp'] : ['pwd'],
      familyId: session.familyId,
    });
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
