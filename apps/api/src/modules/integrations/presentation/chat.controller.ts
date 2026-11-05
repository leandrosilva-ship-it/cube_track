import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { ChatService } from '../application/chat.service.js';
import * as S from './schemas.js';

const EventBody = z.record(z.string(), z.unknown());

/** Slack/Microsoft Teams (ADR 0056) — notificação de saída (webhook de entrada do canal) e, só no
 * Slack, comando de barra e link preview (endpoint de entrada adicional autenticado pela assinatura do
 * app Slack do tenant). */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('workspaces/:workspaceId/integrations/slack/connect')
  @Audited({ action: 'integration_connection.connect', entityType: 'integration_connection' })
  @Endpoint({
    summary: 'Conectar o Slack do workspace (Incoming Webhook + signing secret)',
    description: 'Requer `integrations.manage`.',
    tags: ['integrations'],
    status: 204,
    params: S.WorkspaceParams,
    body: S.SlackConnectBody,
  })
  async connectSlack(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.SlackConnectBody>,
  ) {
    await this.chat.connectSlack(user, params.workspaceId, body);
  }

  @Post('workspaces/:workspaceId/integrations/teams/connect')
  @Audited({ action: 'integration_connection.connect', entityType: 'integration_connection' })
  @Endpoint({
    summary: 'Conectar o Microsoft Teams do workspace (Incoming Webhook/connector)',
    description:
      'Requer `integrations.manage`. Sem slash command/mensagem interativa nesta entrega (exigiria o ' +
      'Bot Framework) — escopo reduzido deliberado.',
    tags: ['integrations'],
    status: 204,
    params: S.WorkspaceParams,
    body: S.TeamsConnectBody,
  })
  async connectTeams(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.TeamsConnectBody>,
  ) {
    await this.chat.connectTeams(user, params.workspaceId, body);
  }

  @Post('integrations/slack/:connectionId/events')
  @RateLimit({ limit: 120, windowSeconds: 60, by: 'ip', bucket: 'slack-events' })
  @Audited({ action: 'integration.slack_event', entityType: 'integration_connection', transactional: false })
  @Endpoint({
    summary: 'Events API/slash command do Slack',
    description:
      'Público. Verifica `X-Slack-Signature`/`X-Slack-Request-Timestamp` (rejeita após 5 min). Trata o ' +
      'desafio `url_verification`, o comando `/cubetrack create <nome>` e o evento `link_shared`.',
    tags: ['public'],
    public: true,
    status: 200,
    params: S.ConnectionParams,
    body: EventBody,
  })
  async events(
    @Input('params') params: z.infer<typeof S.ConnectionParams>,
    @Input('body') body: z.infer<typeof EventBody>,
    @Headers('x-slack-signature') signature: string | undefined,
    @Headers('x-slack-request-timestamp') timestamp: string | undefined,
    @Req() request: Request,
  ) {
    const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(body);
    const result = await this.chat.handleSlackEvent(params.connectionId, { timestamp, signature }, rawBody, body);
    if (result.kind === 'challenge') return result.challenge;
    if (result.kind === 'slash_command') return result.slashCommandResponse;
    if (result.kind === 'unfurl') return result.unfurlPayload;
    return { ok: true };
  }
}
