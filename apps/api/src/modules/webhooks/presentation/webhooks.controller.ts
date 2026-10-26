import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { WebhooksService } from '../application/webhooks.service.js';
import * as S from './schemas.js';

/** CRUD de webhooks de saída (ADR 0051): por board ou por workspace inteiro. */
@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get('boards/:boardId/webhooks')
  @Endpoint({
    summary: 'Listar webhooks do board',
    description: 'Requer `webhook.manage` no board. O segredo nunca é devolvido aqui.',
    tags: ['webhooks'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.WebhookSchema) }),
  })
  async listForBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.webhooks.listForBoard(user, params.boardId) };
  }

  @Post('boards/:boardId/webhooks')
  @Audited({ action: 'webhook.create', entityType: 'webhook' })
  @Endpoint({
    summary: 'Criar webhook de board',
    description:
      'Requer `webhook.manage` no board. A resposta traz o segredo HMAC em texto simples ' +
      '(`secret`) uma única vez — guarde-o agora.',
    tags: ['webhooks'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateWebhookBody,
    response: S.WebhookWithSecretSchema,
  })
  createForBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateWebhookBody>,
  ) {
    return this.webhooks.createForBoard(user, params.boardId, body);
  }

  @Get('workspaces/:workspaceId/webhooks')
  @Endpoint({
    summary: 'Listar webhooks de workspace inteiro',
    description: 'Requer `workspace.manage`. Não inclui webhooks de um board específico.',
    tags: ['webhooks'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.WebhookSchema) }),
  })
  async listForWorkspace(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
  ) {
    return { data: await this.webhooks.listForWorkspace(user, params.workspaceId) };
  }

  @Post('workspaces/:workspaceId/webhooks')
  @Audited({ action: 'webhook.create', entityType: 'webhook' })
  @Endpoint({
    summary: 'Criar webhook de workspace inteiro',
    description: 'Requer `workspace.manage`. Aplica-se a todos os boards do workspace.',
    tags: ['webhooks'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateWebhookBody,
    response: S.WebhookWithSecretSchema,
  })
  createForWorkspace(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateWebhookBody>,
  ) {
    return this.webhooks.createForWorkspace(user, params.workspaceId, body);
  }

  @Patch('webhooks/:id')
  @Audited({ action: 'webhook.update', entityType: 'webhook' })
  @Endpoint({
    summary: 'Atualizar webhook (nome, url, eventos, cabeçalhos, habilitar/desabilitar)',
    tags: ['webhooks'],
    params: IdParams,
    body: S.UpdateWebhookBody,
    response: S.WebhookSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateWebhookBody>,
  ) {
    return this.webhooks.update(user, params.id, body);
  }

  @Post('webhooks/:id/regenerate-secret')
  @Audited({ action: 'webhook.secret_regenerated', entityType: 'webhook' })
  @Endpoint({
    summary: 'Regenerar o segredo HMAC (invalida o anterior)',
    description: 'A resposta traz o novo segredo em texto simples (`secret`) uma única vez.',
    tags: ['webhooks'],
    params: IdParams,
    response: S.WebhookWithSecretSchema,
  })
  regenerateSecret(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return this.webhooks.regenerateSecret(user, params.id);
  }

  @Delete('webhooks/:id')
  @Audited({ action: 'webhook.delete', entityType: 'webhook' })
  @Endpoint({ summary: 'Excluir webhook', tags: ['webhooks'], params: IdParams, status: 204 })
  async remove(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.webhooks.remove(user, params.id);
  }
}
