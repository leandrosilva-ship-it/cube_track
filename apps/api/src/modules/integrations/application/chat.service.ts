import { Inject, Injectable } from '@nestjs/common';
import { schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import { verifySlackSignature } from '@cube-track/shared/integrations';
import { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { APP_DB } from '../../../core/database/tokens.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemWriter } from '../../work/application/item-writer.js';
import { ItemsService } from '../../work/application/items.service.js';
import { PublicConnectionResolver, type ResolvedConnection } from '../infrastructure/public-connection-resolver.js';

const { groups, integrationConnections } = schema;

export interface SlackEventResult {
  kind: 'challenge' | 'slash_command' | 'unfurl' | 'ignored';
  /** Resposta do desafio de verificação de URL (`url_verification`) — devolvida em texto puro. */
  challenge?: string;
  /** Resposta imediata do comando de barra (ADR 0056: Slack espera um corpo JSON simples). */
  slashCommandResponse?: { response_type: 'ephemeral' | 'in_channel'; text: string };
  /**
   * Payload de unfurl pronto (ADR 0056) — CUBE PROJECT só tem a URL de "Incoming Webhook" e o signing
   * secret do app Slack (BYOK), não um bot token com escopo `links:read`/`links:write`; sem ele não dá
   * para chamar `chat.unfurl` de volta para o Slack (ficaria limitado a mandar mensagens PARA um canal
   * fixo, não a enriquecer um link específico). Documentado como lacuna conhecida: o payload é montado
   * e devolvido aqui, pronto para quando o app ganhar esse escopo/token.
   */
  unfurlPayload?: Record<string, unknown>;
}

/**
 * Slack/Microsoft Teams (ADR 0056) — conexão de workspace inteiro (`authKind: 'webhook_secret'`,
 * `userId` nulo). "Agir como" em um comando de barra do Slack (sem sessão de usuário nenhuma): a ação é
 * atribuída a quem CONECTOU o app (`integration_connections.createdBy`, coluna padrão de toda tabela do
 * tenant — não precisou de um campo `connectedBy` à parte), com as permissões normais dessa pessoa como
 * teto (mesmo raciocínio do token de app OAuth do Deliverable 1: nunca mais do que o dono poderia fazer
 * pela própria sessão) — nunca `authKind: 'api_token'` (não há escopos de API aqui, só RBAC normal).
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly resolver: PublicConnectionResolver,
    private readonly items: ItemsService,
    private readonly itemWriter: ItemWriter,
  ) {}

  async connectSlack(
    user: AuthPrincipal,
    workspaceId: string,
    input: { incomingWebhookUrl: string; signingSecret: string; defaultBoardId?: string | undefined },
  ): Promise<void> {
    await this.access.assert(user, 'integrations.manage', { type: 'workspace', id: workspaceId });
    let defaultGroupId: string | null = null;
    if (input.defaultBoardId !== undefined) {
      const [group] = await this.runner.tx
        .select({ id: groups.id })
        .from(groups)
        .where(and(eq(groups.boardId, input.defaultBoardId), isNull(groups.deletedAt)))
        .orderBy(asc(groups.position))
        .limit(1);
      if (group === undefined)
        throw new NotFoundError('Grupo padrão (o board precisa de ao menos um grupo)');
      defaultGroupId = group.id;
    }
    await this.upsertWebhookConnection(user, workspaceId, 'slack', {
      webhookSecretCiphertext: encryptSecret(input.signingSecret, this.config.ENCRYPTION_KEY),
      outboundWebhookUrlCiphertext: encryptSecret(input.incomingWebhookUrl, this.config.ENCRYPTION_KEY),
      metadata: {
        ...(input.defaultBoardId === undefined ? {} : { defaultBoardId: input.defaultBoardId, defaultGroupId }),
      },
    });
  }

  async connectTeams(
    user: AuthPrincipal,
    workspaceId: string,
    input: { incomingWebhookUrl: string },
  ): Promise<void> {
    await this.access.assert(user, 'integrations.manage', { type: 'workspace', id: workspaceId });
    // Connector do Teams (webhook de entrada simples) não tem segredo de assinatura para validar
    // requisições DE ENTRADA — escopo reduzido deliberado (ADR 0056): sem suporte a slash
    // command/mensagem interativa do Teams nesta entrega (exigiria o Bot Framework, fora de escopo).
    await this.upsertWebhookConnection(user, workspaceId, 'teams', {
      webhookSecretCiphertext: null,
      outboundWebhookUrlCiphertext: encryptSecret(input.incomingWebhookUrl, this.config.ENCRYPTION_KEY),
      metadata: {},
    });
  }

  /** `POST /v1/integrations/slack/:connectionId/events` (público) — Events API + slash command. */
  async handleSlackEvent(
    connectionId: string,
    headers: { timestamp: string | undefined; signature: string | undefined },
    rawBody: string,
    body: Record<string, unknown>,
  ): Promise<SlackEventResult> {
    const connection = await this.resolver.resolve(connectionId);
    if (connection?.provider !== 'slack' || connection.webhookSecretCiphertext === null)
      throw new NotFoundError('Conexão Slack');
    const signingSecret = decryptSecret(connection.webhookSecretCiphertext, this.config.ENCRYPTION_KEY);
    const valid = verifySlackSignature({
      signingSecret,
      timestamp: headers.timestamp,
      rawBody,
      signatureHeader: headers.signature,
    });
    if (!valid) throw new NotFoundError('Assinatura inválida'); // 404 genérico: não revela a existência da conexão

    if (body.type === 'url_verification' && typeof body.challenge === 'string') {
      return { kind: 'challenge', challenge: body.challenge };
    }
    if (body.type === 'event_callback' && typeof body.event === 'object' && body.event !== null) {
      const event = body.event as Record<string, unknown>;
      if (event.type === 'link_shared') return this.handleLinkShared(connection, event);
      return { kind: 'ignored' };
    }
    if (typeof body.command === 'string') return this.handleSlashCommand(connection, body);
    return { kind: 'ignored' };
  }

  private async handleSlashCommand(
    connection: ResolvedConnection,
    body: Record<string, unknown>,
  ): Promise<SlackEventResult> {
    const defaultBoardId = typeof connection.metadata.defaultBoardId === 'string' ? connection.metadata.defaultBoardId : null;
    const defaultGroupId = typeof connection.metadata.defaultGroupId === 'string' ? connection.metadata.defaultGroupId : null;
    if (defaultBoardId === null || defaultGroupId === null) {
      return {
        kind: 'slash_command',
        slashCommandResponse: {
          response_type: 'ephemeral',
          text: 'Nenhum board padrão configurado para este workspace Slack. Peça a um administrador para reconectar a integração informando um board.',
        },
      };
    }
    const rawText = typeof body.text === 'string' ? body.text.trim() : '';
    const name = rawText.toLowerCase().startsWith('create ') ? rawText.slice('create '.length).trim() : rawText;
    if (name === '') {
      return {
        kind: 'slash_command',
        slashCommandResponse: { response_type: 'ephemeral', text: 'Uso: `/cubetrack create <nome do item>`.' },
      };
    }
    const connectedBy = await this.resolveConnectedBy(connection);
    // `authKind` fica indefinido (sessão normal), não `'api_token'`: um comando de barra não tem
    // escopos de API — o teto é só o RBAC normal de quem conectou o app (doc da classe).
    const actingUser: AuthPrincipal = {
      userId: connectedBy,
      tenantId: connection.tenantId,
      sessionId: `slack-command:${connection.id}`,
      kind: 'member',
    };
    try {
      const itemName = await this.runner.run(
        { tenantId: connection.tenantId, userId: connectedBy, actorKind: 'api' },
        async () => {
          await this.access.assert(actingUser, 'item.create', { type: 'board', id: defaultBoardId }, 'Board');
          const context = await this.itemWriter.context(actingUser, defaultBoardId);
          const position = await this.itemWriter.resolvePosition(defaultGroupId, null, undefined);
          // Captura rápida via Slack (ADR 0056): um comando de barra não tem como preencher colunas
          // obrigatórias específicas do board — `enforceRequired: false` é uma exceção deliberada só
          // deste fluxo (a criação normal pela UI/API continua exigindo os campos obrigatórios).
          const item = await this.itemWriter.insert(
            context,
            { groupId: defaultGroupId, name, position },
            { enforceRequired: false },
          );
          await this.itemWriter.emitCreated(context, item, 'created');
          return item.name;
        },
      );
      return {
        kind: 'slash_command',
        slashCommandResponse: { response_type: 'in_channel', text: `Item criado: *${itemName}*` },
      };
    } catch (error) {
      return {
        kind: 'slash_command',
        slashCommandResponse: {
          response_type: 'ephemeral',
          text: `Não foi possível criar o item: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
        },
      };
    }
  }

  /** `integration_connections.createdBy` (coluna padrão de toda tabela do tenant) é quem conectou o
   * app — a identidade "agindo" por trás de um comando de barra/unfurl sem sessão (doc da classe). */
  private async resolveConnectedBy(connection: ResolvedConnection): Promise<string> {
    const [row] = await withTenant(
      this.database.db,
      { tenantId: connection.tenantId, userId: null },
      (tx) =>
        tx
          .select({ createdBy: integrationConnections.createdBy })
          .from(integrationConnections)
          .where(eq(integrationConnections.id, connection.id)),
    );
    if (row?.createdBy === null || row?.createdBy === undefined)
      throw new NotFoundError('Usuário que conectou a integração');
    return row.createdBy;
  }

  private async handleLinkShared(
    connection: ResolvedConnection,
    event: Record<string, unknown>,
  ): Promise<SlackEventResult> {
    const links = Array.isArray(event.links) ? (event.links as { url?: unknown }[]) : [];
    const unfurls: Record<string, unknown> = {};
    for (const link of links) {
      const url = typeof link.url === 'string' ? link.url : null;
      if (url === null) continue;
      const match = /\/items\/([0-9a-fA-F-]{36})/.exec(url);
      if (match?.[1] === undefined) continue;
      const itemId = match[1];
      const actingUserId = await this.resolveConnectedBy(connection);
      try {
        const item = await this.runner.run({ tenantId: connection.tenantId, userId: actingUserId }, () =>
          this.items.get({ userId: actingUserId, tenantId: connection.tenantId, sessionId: 'slack-unfurl', kind: 'member' }, itemId),
        );
        unfurls[url] = { title: item.name, title_link: url };
      } catch {
        // item inexistente/sem permissão para quem conectou: não desenrola este link.
        continue;
      }
    }
    return {
      kind: 'unfurl',
      unfurlPayload: { channel: event.channel, ts: event.message_ts, unfurls },
    };
  }

  private async upsertWebhookConnection(
    user: AuthPrincipal,
    workspaceId: string,
    provider: 'slack' | 'teams',
    values: {
      webhookSecretCiphertext: string | null;
      outboundWebhookUrlCiphertext: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    const [existing] = await this.runner.tx
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.workspaceId, workspaceId),
          eq(integrationConnections.provider, provider),
          isNull(integrationConnections.userId),
          isNull(integrationConnections.deletedAt),
        ),
      );
    let connectionId: string;
    if (existing === undefined) {
      const [created] = await this.runner.tx
        .insert(integrationConnections)
        .values({
          tenantId: user.tenantId,
          workspaceId,
          provider,
          authKind: 'webhook_secret',
          userId: null,
          isActive: true,
          createdBy: user.userId,
          ...values,
        })
        .returning({ id: integrationConnections.id });
      if (created === undefined) throw new Error('Falha ao conectar integração');
      connectionId = created.id;
    } else {
      connectionId = existing.id;
      await this.runner.tx
        .update(integrationConnections)
        .set({ ...values, isActive: true })
        .where(eq(integrationConnections.id, existing.id));
    }
    this.events.recordChange({
      action: 'integration_connection.connected',
      entityType: 'integration_connection',
      entityId: connectionId,
      after: { provider, workspaceId },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'integration_connection.changed',
      aggregateType: 'integration_connection',
      aggregateId: connectionId,
      payload: { connectionId, workspaceId, provider, change: 'connected' },
      actorId: user.userId,
    });
  }
}
