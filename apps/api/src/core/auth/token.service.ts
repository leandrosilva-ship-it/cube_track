import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { hashApiToken, isApiScope } from '@cube-track/shared/api-access';
import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT, errors as joseErrors } from 'jose';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { AuthPrincipal } from '../context/request-context.js';
import { AUTH_DB } from '../database/tokens.js';
import { UnauthorizedError } from '../errors/problems.js';

const { apiTokens, oauthApps, memberships } = schema;

const AccessClaims = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  sid: z.uuid(),
  knd: z.enum(['member', 'guest']),
  amr: z.array(z.string()),
  exp: z.number(),
});

export interface AccessTokenInput extends AuthPrincipal {
  /** Métodos de autenticação usados (pwd, otp, magic, oauth). */
  amr: string[];
}

export interface VerifiedAccessToken {
  principal: AuthPrincipal;
  amr: string[];
  expiresAt: number;
}

/** Emissão e verificação dos access tokens (JWT HS256, curtos — ADR 0026). */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AUTH_DB) private readonly authDb: DatabaseHandle,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessTokenTtlSeconds(): number {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  async signAccessToken(input: AccessTokenInput): Promise<string> {
    return new SignJWT({
      tid: input.tenantId,
      sid: input.sessionId,
      knd: input.kind,
      amr: input.amr,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(input.userId)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_ISSUER,
        algorithms: ['HS256'],
        typ: 'at+jwt',
      });
      const claims = AccessClaims.parse(payload);
      return {
        principal: {
          userId: claims.sub,
          tenantId: claims.tid,
          sessionId: claims.sid,
          kind: claims.knd,
        },
        amr: claims.amr,
        expiresAt: claims.exp * 1000,
      };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired)
        throw new UnauthorizedError('token_expired', 'Token de acesso expirado.');
      throw new UnauthorizedError('token_invalid', 'Token de acesso inválido.');
    }
  }

  /**
   * Verifica um token de API (`ctk_…`, ADR 0056): pessoal (`userId` preenchido) ou de app OAuth
   * (`oauthAppId` preenchido, emitido por `POST /v1/oauth/token`). Um app OAuth não tem identidade
   * própria no grafo de RBAC — a requisição herda exatamente as permissões de quem registrou o app
   * (`oauthApps.createdBy`), reduzidas pelos `scopes` do token, igual a um token pessoal. Consulta com
   * o papel `app_auth` (0029), o mesmo usado para sessões, antes de qualquer contexto de tenant
   * existir. Atualiza `lastUsedAt`/`lastUsedIp` de forma best-effort (nunca bloqueia a requisição).
   */
  async verifyApiToken(token: string, ip: string | null): Promise<VerifiedAccessToken> {
    const tokenHash = hashApiToken(token);
    const [row] = await this.authDb.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash));
    if (row === undefined) throw new UnauthorizedError('token_invalid', 'Token de acesso inválido.');
    if (row.revokedAt !== null)
      throw new UnauthorizedError('token_revoked', 'Token de acesso revogado.');
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedError('token_expired', 'Token de acesso expirado.');

    let userId: string;
    if (row.userId !== null) {
      userId = row.userId;
    } else if (row.oauthAppId !== null) {
      const [app] = await this.authDb.db
        .select({ createdBy: oauthApps.createdBy, isActive: oauthApps.isActive })
        .from(oauthApps)
        .where(and(eq(oauthApps.id, row.oauthAppId), isNull(oauthApps.deletedAt)));
      if (app === undefined || !app.isActive || app.createdBy === null)
        throw new UnauthorizedError('token_invalid', 'App OAuth inativo ou excluído.');
      userId = app.createdBy;
    } else {
      // Nunca deveria acontecer (CHECK api_tokens_owner_xor), mas sem isso o TS não estreita o tipo.
      throw new UnauthorizedError('token_invalid', 'Token de acesso inválido.');
    }

    const [membership] = await this.authDb.db
      .select({ kind: memberships.kind })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, row.tenantId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          isNull(memberships.deletedAt),
        ),
      );
    if (membership === undefined)
      throw new UnauthorizedError(
        'membership_inactive',
        'Você não participa mais desta organização.',
      );

    void this.authDb.db
      .update(apiTokens)
      .set({ lastUsedAt: new Date(), ...(ip === null ? {} : { lastUsedIp: ip }) })
      .where(eq(apiTokens.id, row.id))
      .catch(() => {
        // best-effort: nunca bloqueia a requisição por falha nesse bookkeeping.
      });

    const scopes = row.scopes.filter(isApiScope);
    return {
      principal: {
        userId,
        tenantId: row.tenantId,
        sessionId: row.id,
        kind: membership.kind,
        authKind: 'api_token',
        apiTokenId: row.id,
        scopes,
      },
      amr: ['api_token'],
      expiresAt: row.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    };
  }
}
