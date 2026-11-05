import { Controller, Delete, Get, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { ApiTokensService } from '../application/api-tokens.service.js';
import * as S from './schemas.js';

/**
 * Autosserviço de tokens de API pessoais (ADR 0056) — sem permissão especial, igual a trocar a
 * própria senha. Nunca aceita autenticação por outro token de API (`ApiTokensService.assertSession`).
 */
@Controller('me/tokens')
export class MeTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  @Endpoint({
    summary: 'Listar os meus tokens de API',
    description: 'Autosserviço — não mostra o token em texto simples, só prefixo e metadados.',
    tags: ['api-access'],
    response: z.object({ data: z.array(S.ApiTokenSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.tokens.listOwn(user) };
  }

  @Post()
  @Audited({ action: 'api_token.create', entityType: 'api_token' })
  @Endpoint({
    summary: 'Criar um token de API pessoal',
    description:
      'A resposta traz o token em texto simples (`token`, prefixo `ctk_`) uma única vez — guarde-o ' +
      'agora. Exige sessão de login (um token de API nunca cria outro).',
    tags: ['api-access'],
    status: 201,
    body: S.CreateApiTokenBody,
    response: S.ApiTokenWithSecretSchema,
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.CreateApiTokenBody>,
  ) {
    return this.tokens.createOwn(user, body);
  }

  @Delete(':id')
  @Audited({ action: 'api_token.revoke', entityType: 'api_token' })
  @Endpoint({
    summary: 'Revogar um dos meus tokens de API',
    tags: ['api-access'],
    status: 204,
    params: IdParams,
  })
  async revoke(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.tokens.revokeOwn(user, params.id);
  }
}
