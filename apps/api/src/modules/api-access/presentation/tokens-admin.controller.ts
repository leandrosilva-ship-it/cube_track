import { Controller, Delete, Get } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { ApiTokensService } from '../application/api-tokens.service.js';
import * as S from './schemas.js';

/** Administração de tokens de API de QUALQUER usuário do tenant (ADR 0056) — requer `api_tokens.manage`. */
@Controller('tokens')
export class TokensAdminController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  @Endpoint({
    summary: 'Listar todos os tokens de API do tenant (pessoais e de apps)',
    description: 'Requer `api_tokens.manage`.',
    tags: ['api-access'],
    response: z.object({ data: z.array(S.ApiTokenSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.tokens.listAll(user) };
  }

  @Delete(':id')
  @Audited({ action: 'api_token.revoke', entityType: 'api_token' })
  @Endpoint({
    summary: 'Revogar o token de API de qualquer usuário',
    description: 'Requer `api_tokens.manage`.',
    tags: ['api-access'],
    status: 204,
    params: IdParams,
  })
  async revoke(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.tokens.revokeAny(user, params.id);
  }
}
