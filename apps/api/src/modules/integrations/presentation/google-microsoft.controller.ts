import { Controller, Delete, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { GoogleMicrosoftService } from '../application/google-microsoft.service.js';
import * as S from './schemas.js';

/** Google Workspace/Microsoft 365 (ADR 0056) — OAuth (calendário, Drive/OneDrive por referência). */
@Controller()
export class GoogleMicrosoftController {
  constructor(private readonly service: GoogleMicrosoftService) {}

  @Post('workspaces/:workspaceId/integrations/google/connect')
  @Audited({ action: 'integration_app.connect', entityType: 'integration_app' })
  @Endpoint({
    summary: 'Cadastrar o app OAuth do Google Workspace e obter a URL de autorização',
    description:
      'Requer `integrations.manage`. `clientId`/`clientSecret` são do PRÓPRIO app OAuth do tenant (Google ' +
      'Cloud Console, BYOK) — a resposta traz a URL para o usuário atual visitar e consentir.',
    tags: ['integrations'],
    status: 200,
    params: S.WorkspaceParams,
    body: S.GoogleMicrosoftConnectBody,
    response: S.AuthorizationUrlResponse,
  })
  connectGoogle(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.GoogleMicrosoftConnectBody>,
  ) {
    return this.service.connect(user, params.workspaceId, 'google', body);
  }

  @Post('workspaces/:workspaceId/integrations/microsoft/connect')
  @Audited({ action: 'integration_app.connect', entityType: 'integration_app' })
  @Endpoint({
    summary: 'Cadastrar o app OAuth do Microsoft 365 e obter a URL de autorização',
    description:
      'Requer `integrations.manage`. `clientId`/`clientSecret` são do PRÓPRIO app OAuth do tenant (Azure ' +
      'AD/Entra ID, BYOK) — a resposta traz a URL para o usuário atual visitar e consentir.',
    tags: ['integrations'],
    status: 200,
    params: S.WorkspaceParams,
    body: S.GoogleMicrosoftConnectBody,
    response: S.AuthorizationUrlResponse,
  })
  connectMicrosoft(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.GoogleMicrosoftConnectBody>,
  ) {
    return this.service.connect(user, params.workspaceId, 'microsoft', body);
  }

  @Get('integrations/:provider/callback')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', bucket: 'integration-oauth' })
  @Audited({ action: 'integration_connection.oauth_callback', entityType: 'integration_connection', transactional: false })
  @Endpoint({
    summary: 'Callback OAuth do Google/Microsoft (redireciona ao app)',
    description: 'Público. Gerencia a própria transação — mesmo padrão do callback OAuth de login.',
    tags: ['integrations'],
    public: true,
    params: S.GoogleMicrosoftProviderParams,
    query: S.OAuthCallbackQuery,
    errors: [302],
  })
  async callback(
    @Input('params') params: z.infer<typeof S.GoogleMicrosoftProviderParams>,
    @Input('query') query: z.infer<typeof S.OAuthCallbackQuery>,
    @Res() response: Response,
  ) {
    const { redirectUrl } = await this.service.callback(params.provider, query.code, query.state);
    response.redirect(302, redirectUrl);
  }

  @Post('items/:itemId/external-files')
  @Audited({ action: 'external_file_link.create', entityType: 'external_file_link' })
  @Endpoint({
    summary: 'Vincular um arquivo do Google Drive/OneDrive a um item (por referência)',
    description: 'Requer `item.update` e uma conexão Google/Microsoft ativa do usuário atual.',
    tags: ['integrations'],
    status: 201,
    params: S.ItemParams,
    body: S.ExternalFileLinkBody,
    response: S.ExternalFileLinkSchema,
  })
  linkExternalFile(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ItemParams>,
    @Input('body') body: z.infer<typeof S.ExternalFileLinkBody>,
  ) {
    return this.service.linkExternalFile(user, params.itemId, body);
  }

  @Get('items/:itemId/external-files')
  @Endpoint({
    summary: 'Listar arquivos do Drive/OneDrive vinculados a um item',
    tags: ['integrations'],
    params: S.ItemParams,
    response: z.object({ data: z.array(S.ExternalFileLinkSchema) }),
  })
  async listExternalFiles(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ItemParams>,
  ) {
    return { data: await this.service.listExternalFiles(user, params.itemId) };
  }

  @Delete('external-files/:id')
  @Audited({ action: 'external_file_link.delete', entityType: 'external_file_link' })
  @Endpoint({
    summary: 'Remover o vínculo de um arquivo externo (não apaga o arquivo no Drive/OneDrive)',
    tags: ['integrations'],
    status: 204,
    params: S.ExternalFileParams,
  })
  async unlinkExternalFile(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ExternalFileParams>,
  ) {
    await this.service.unlinkExternalFile(user, params.id);
  }
}
