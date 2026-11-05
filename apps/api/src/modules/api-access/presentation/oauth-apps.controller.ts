import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { OAuthAppsService } from '../application/oauth-apps.service.js';
import * as S from './schemas.js';

/** CRUD de apps OAuth do tenant (ADR 0056) — sempre requer `api_tokens.manage`. */
@Controller('oauth-apps')
export class OAuthAppsController {
  constructor(private readonly apps: OAuthAppsService) {}

  @Get()
  @Endpoint({
    summary: 'Listar apps OAuth do tenant',
    description: 'Requer `api_tokens.manage`.',
    tags: ['api-access'],
    response: z.object({ data: z.array(S.OAuthAppSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.apps.list(user) };
  }

  @Post()
  @Audited({ action: 'oauth_app.create', entityType: 'oauth_app' })
  @Endpoint({
    summary: 'Registrar um app OAuth (client_credentials)',
    description:
      'Requer `api_tokens.manage`. A resposta traz `clientSecret` em texto simples uma única vez — ' +
      'use-o com `clientId` em `POST /v1/oauth/token`.',
    tags: ['api-access'],
    status: 201,
    body: S.CreateOAuthAppBody,
    response: S.OAuthAppWithSecretSchema,
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.CreateOAuthAppBody>,
  ) {
    return this.apps.create(user, body);
  }

  @Patch(':id')
  @Audited({ action: 'oauth_app.update', entityType: 'oauth_app' })
  @Endpoint({
    summary: 'Atualizar um app OAuth (nome, descrição, escopos, ativo/inativo)',
    description: 'Requer `api_tokens.manage`.',
    tags: ['api-access'],
    params: IdParams,
    body: S.UpdateOAuthAppBody,
    response: S.OAuthAppSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateOAuthAppBody>,
  ) {
    return this.apps.update(user, params.id, body);
  }

  @Delete(':id')
  @Audited({ action: 'oauth_app.delete', entityType: 'oauth_app' })
  @Endpoint({
    summary: 'Excluir um app OAuth (revoga todos os tokens que ele emitiu)',
    description: 'Requer `api_tokens.manage`.',
    tags: ['api-access'],
    status: 204,
    params: IdParams,
  })
  async remove(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.apps.remove(user, params.id);
  }
}
