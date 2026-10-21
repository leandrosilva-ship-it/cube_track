import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { UnauthorizedError } from '../../../core/errors/problems.js';

const ShareClaims = z.object({
  shl: z.uuid(),
  tid: z.uuid(),
  vid: z.uuid(),
  bid: z.uuid(),
  exp: z.number(),
});

export interface ShareSessionInput {
  shareLinkId: string;
  tenantId: string;
  viewId: string;
  boardId: string;
}

export interface VerifiedShareSession {
  shareLinkId: string;
  tenantId: string;
  viewId: string;
  boardId: string;
}

/** Duração da sessão de leitura de um link público — nova verificação de senha depois disso. */
export const SHARE_SESSION_TTL_SECONDS = 3_600;

/**
 * Sessão curta do link público (ADR 0047): emitida após `verify` (senha, se exigida) e exigida nas
 * leituras seguintes do board/itens. JWT distinto do access token (`typ` próprio), mesmo segredo —
 * mesmo limite de confiança da API, claims e propósito diferentes.
 */
@Injectable()
export class ShareSessionService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  async sign(input: ShareSessionInput): Promise<string> {
    return new SignJWT({ shl: input.shareLinkId, tid: input.tenantId, vid: input.viewId })
      .setProtectedHeader({ alg: 'HS256', typ: 'share+jwt' })
      .setSubject(input.boardId)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${String(SHARE_SESSION_TTL_SECONDS)}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<VerifiedShareSession> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_ISSUER,
        algorithms: ['HS256'],
        typ: 'share+jwt',
      });
      const claims = ShareClaims.parse({ ...payload, bid: payload.sub });
      return {
        shareLinkId: claims.shl,
        tenantId: claims.tid,
        viewId: claims.vid,
        boardId: claims.bid,
      };
    } catch {
      throw new UnauthorizedError('share_session_invalid', 'Sessão de link público inválida ou expirada.');
    }
  }
}
