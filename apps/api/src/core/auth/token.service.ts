import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT, errors as joseErrors } from 'jose';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { AuthPrincipal } from '../context/request-context.js';
import { UnauthorizedError } from '../errors/problems.js';

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

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
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
}
