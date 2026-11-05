import { Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { DevEventsService } from '../application/dev-events.service.js';
import * as S from './schemas.js';

const WebhookBody = z.record(z.string(), z.unknown());

/** GitHub/GitLab/Azure DevOps (ADR 0056) — integração só de ENTRADA: webhook do repositório vincula
 * commits/PRs a itens (`#token` ou UUID na mensagem) e, ao mesclar um PR/MR, tenta avançar o status. */
@Controller()
export class DevEventsController {
  constructor(private readonly devEvents: DevEventsService) {}

  @Post('workspaces/:workspaceId/integrations/github/connect')
  @Audited({ action: 'integration_connection.connect', entityType: 'integration_connection' })
  @Endpoint({
    summary: 'Conectar um repositório GitHub (segredo do webhook)',
    description: 'Requer `integrations.manage`. Configure o mesmo segredo no webhook do repositório.',
    tags: ['integrations'],
    status: 204,
    params: S.WorkspaceParams,
    body: S.WebhookSecretConnectBody,
  })
  async connectGithub(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.WebhookSecretConnectBody>,
  ) {
    await this.devEvents.connectGithubOrGitlab(user, params.workspaceId, 'github', body.webhookSecret);
  }

  @Post('workspaces/:workspaceId/integrations/gitlab/connect')
  @Audited({ action: 'integration_connection.connect', entityType: 'integration_connection' })
  @Endpoint({
    summary: 'Conectar um repositório GitLab (token do webhook)',
    description: 'Requer `integrations.manage`. Configure o mesmo token no webhook do projeto.',
    tags: ['integrations'],
    status: 204,
    params: S.WorkspaceParams,
    body: S.WebhookSecretConnectBody,
  })
  async connectGitlab(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.WebhookSecretConnectBody>,
  ) {
    await this.devEvents.connectGithubOrGitlab(user, params.workspaceId, 'gitlab', body.webhookSecret);
  }

  @Post('workspaces/:workspaceId/integrations/azure-devops/connect')
  @Audited({ action: 'integration_connection.connect', entityType: 'integration_connection' })
  @Endpoint({
    summary: 'Conectar um repositório Azure DevOps (usuário/senha do service hook)',
    description:
      'Requer `integrations.manage`. Configure o mesmo usuário/senha como HTTP Basic Auth no service ' +
      'hook do Azure DevOps.',
    tags: ['integrations'],
    status: 204,
    params: S.WorkspaceParams,
    body: S.AzureDevOpsConnectBody,
  })
  async connectAzureDevOps(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.AzureDevOpsConnectBody>,
  ) {
    await this.devEvents.connectAzureDevOps(user, params.workspaceId, body);
  }

  @Post('integrations/github/:connectionId/webhook')
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'ip', bucket: 'dev-events-webhook' })
  @Audited({ action: 'integration.github_webhook', entityType: 'dev_event_link', transactional: false })
  @Endpoint({
    summary: 'Webhook do GitHub (push/pull_request)',
    description: 'Público. Verifica `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto).',
    tags: ['public'],
    public: true,
    status: 200,
    params: S.ConnectionParams,
    body: WebhookBody,
  })
  async githubWebhook(
    @Input('params') params: z.infer<typeof S.ConnectionParams>,
    @Input('body') body: z.infer<typeof WebhookBody>,
    @Headers('x-github-event') eventType: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() request: Request,
  ) {
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(body);
    return this.devEvents.handleGithubWebhook(params.connectionId, eventType ?? '', signature, rawBody, body);
  }

  @Post('integrations/gitlab/:connectionId/webhook')
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'ip', bucket: 'dev-events-webhook' })
  @Audited({ action: 'integration.gitlab_webhook', entityType: 'dev_event_link', transactional: false })
  @Endpoint({
    summary: 'Webhook do GitLab (Push Hook/Merge Request Hook)',
    description: 'Público. Verifica o token simples em `X-Gitlab-Token` (comparação em tempo constante).',
    tags: ['public'],
    public: true,
    status: 200,
    params: S.ConnectionParams,
    body: WebhookBody,
  })
  gitlabWebhook(
    @Input('params') params: z.infer<typeof S.ConnectionParams>,
    @Input('body') body: z.infer<typeof WebhookBody>,
    @Headers('x-gitlab-token') token: string | undefined,
  ) {
    return this.devEvents.handleGitlabWebhook(params.connectionId, token, body);
  }

  @Post('integrations/azure-devops/:connectionId/webhook')
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'ip', bucket: 'dev-events-webhook' })
  @Audited({ action: 'integration.azure_devops_webhook', entityType: 'dev_event_link', transactional: false })
  @Endpoint({
    summary: 'Service hook do Azure DevOps (git.push/git.pullrequest.*)',
    description: 'Público. Verifica HTTP Basic Auth (usuário/senha cadastrados na conexão).',
    tags: ['public'],
    public: true,
    status: 200,
    params: S.ConnectionParams,
    body: WebhookBody,
  })
  azureDevOpsWebhook(
    @Input('params') params: z.infer<typeof S.ConnectionParams>,
    @Input('body') body: z.infer<typeof WebhookBody>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.devEvents.handleAzureDevOpsWebhook(params.connectionId, authorization, body);
  }

  @Get('items/:itemId/dev-events')
  @Endpoint({
    summary: 'Trilha de commits/PRs vinculados ao item (somente leitura)',
    tags: ['integrations'],
    params: S.ItemParams,
    response: z.object({ data: z.array(S.DevEventLinkSchema) }),
  })
  async listForItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ItemParams>,
  ) {
    return { data: await this.devEvents.listForItem(user, params.itemId) };
  }
}
