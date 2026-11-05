import { Controller, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { OAuthAppsService } from '../application/oauth-apps.service.js';
import * as S from './schemas.js';

/** Emissão de token por `client_credentials` (ADR 0056) — endpoint público, sem sessão. */
@Controller('oauth')
export class OAuthTokenController {
  constructor(private readonly apps: OAuthAppsService) {}

  @Post('token')
  @RateLimit({ limit: 20, windowSeconds: 60, by: 'ip', bucket: 'oauth-token' })
  @Audited({ action: 'oauth.token_issued', entityType: 'api_token', transactional: false })
  @Endpoint({
    summary: 'Trocar client_id/client_secret por um token de API (grant_type=client_credentials)',
    description:
      'Público. O token emitido herda os `scopes` do app (nunca mais do que isso) e expira em 1 hora ' +
      '— chame de novo para renovar (sem refresh token, como de costume em client_credentials).',
    tags: ['api-access'],
    public: true,
    status: 200,
    body: S.OAuthTokenBody,
    response: S.OAuthTokenResponse,
  })
  async issue(@Input('body') body: z.infer<typeof S.OAuthTokenBody>) {
    const issued = await this.apps.issueToken(body.client_id, body.client_secret);
    return {
      access_token: issued.accessToken,
      token_type: issued.tokenType,
      expires_in: issued.expiresIn,
    };
  }
}
