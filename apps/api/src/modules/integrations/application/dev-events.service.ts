import { Inject, Injectable, Logger } from '@nestjs/common';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';
import {
  extractItemReferences,
  normalizeAzureDevOpsEvent,
  normalizeGithubEvent,
  normalizeGitlabEvent,
  verifyGithubSignature,
  type NormalizedDevEvent,
} from '@cube-track/shared/integrations';
import { and, eq, isNull } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { APP_DB } from '../../../core/database/tokens.js';
import { safeEqualString } from '../../../core/crypto/secrets.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnauthorizedError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import { pickStatusAdvance, type StatusColumnCandidate } from '../domain/status-advance.js';
import { PublicConnectionResolver, type ResolvedConnection } from '../infrastructure/public-connection-resolver.js';
import { resolveConnectedByUser, syntheticPrincipal } from './acting-user.js';

const { boards, columnDefinitions, integrationConnections, items, itemFieldIndex, statusLabels, devEventLinks } = schema;

export type DevProvider = 'github' | 'gitlab' | 'azure_devops';

export interface DevEventLinkDto {
  id: string;
  itemId: string;
  connectionId: string;
  kind: string;
  repo: string;
  title: string;
  url: string;
  authorName: string;
  createdAt: string;
}

function toDto(row: typeof devEventLinks.$inferSelect): DevEventLinkDto {
  return {
    id: row.id,
    itemId: row.itemId,
    connectionId: row.connectionId,
    kind: row.kind,
    repo: row.repo,
    title: row.title,
    url: row.url,
    authorName: row.authorName,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface WebhookIngestResult {
  accepted: boolean;
  linkedItemIds: string[];
  statusAdvanced: string[];
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * GitHub/GitLab/Azure DevOps (ADR 0056) — integração só de ENTRADA: um webhook configurado no próprio
 * repositório aponta para a nossa API; nunca chamamos de volta a API do provedor. Conexão de workspace
 * inteiro (`authKind: 'webhook_secret'`, `userId` nulo); cada provedor valida a assinatura do jeito que
 * o PRÓPRIO provedor documenta (nunca um esquema genérico): GitHub HMAC-SHA256 do corpo bruto, GitLab
 * token simples em cabeçalho, Azure DevOps HTTP Basic Auth na URL do service hook.
 */
@Injectable()
export class DevEventsService {
  private readonly logger = new Logger(DevEventsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly resolver: PublicConnectionResolver,
    private readonly items: ItemsService,
  ) {}

  // -------------------------------------------------------------------------------- conexão ---

  async connectGithubOrGitlab(
    user: AuthPrincipal,
    workspaceId: string,
    provider: 'github' | 'gitlab',
    webhookSecret: string,
  ): Promise<void> {
    await this.upsert(user, workspaceId, provider, encryptSecret(webhookSecret, this.config.ENCRYPTION_KEY));
  }

  async connectAzureDevOps(
    user: AuthPrincipal,
    workspaceId: string,
    credentials: { username: string; password: string },
  ): Promise<void> {
    await this.upsert(
      user,
      workspaceId,
      'azure_devops',
      encryptSecret(JSON.stringify(credentials), this.config.ENCRYPTION_KEY),
    );
  }

  private async upsert(
    user: AuthPrincipal,
    workspaceId: string,
    provider: DevProvider,
    webhookSecretCiphertext: string,
  ): Promise<void> {
    await this.access.assert(user, 'integrations.manage', { type: 'workspace', id: workspaceId });
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
          webhookSecretCiphertext,
          isActive: true,
          createdBy: user.userId,
        })
        .returning({ id: integrationConnections.id });
      if (created === undefined) throw new Error('Falha ao conectar integração');
      connectionId = created.id;
    } else {
      connectionId = existing.id;
      await this.runner.tx
        .update(integrationConnections)
        .set({ webhookSecretCiphertext, isActive: true })
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

  // ---------------------------------------------------------------------------------- webhooks ---

  async handleGithubWebhook(
    connectionId: string,
    eventType: string,
    signatureHeader: string | undefined,
    rawBody: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookIngestResult> {
    const connection = await this.requireConnection(connectionId, 'github');
    const secret = decryptSecret(connection.webhookSecretCiphertext ?? '', this.config.ENCRYPTION_KEY);
    if (!verifyGithubSignature(secret, rawBody, signatureHeader))
      throw new UnauthorizedError('webhook_unauthorized', 'Assinatura do GitHub inválida.');
    const normalized = normalizeGithubEvent(eventType, payload);
    return this.ingest(connection, normalized);
  }

  async handleGitlabWebhook(
    connectionId: string,
    tokenHeader: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<WebhookIngestResult> {
    const connection = await this.requireConnection(connectionId, 'gitlab');
    const secret = decryptSecret(connection.webhookSecretCiphertext ?? '', this.config.ENCRYPTION_KEY);
    if (tokenHeader === undefined || !safeEqualString(tokenHeader, secret))
      throw new UnauthorizedError('webhook_unauthorized', 'Token do GitLab inválido.');
    const normalized = normalizeGitlabEvent(payload);
    return this.ingest(connection, normalized);
  }

  async handleAzureDevOpsWebhook(
    connectionId: string,
    authorizationHeader: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<WebhookIngestResult> {
    const connection = await this.requireConnection(connectionId, 'azure_devops');
    const stored = JSON.parse(decryptSecret(connection.webhookSecretCiphertext ?? '', this.config.ENCRYPTION_KEY)) as {
      username: string;
      password: string;
    };
    if (!this.verifyBasicAuth(authorizationHeader, stored))
      throw new UnauthorizedError('webhook_unauthorized', 'Credenciais do Azure DevOps inválidas.');
    const normalized = normalizeAzureDevOpsEvent(payload);
    return this.ingest(connection, normalized);
  }

  private verifyBasicAuth(
    authorizationHeader: string | undefined,
    stored: { username: string; password: string },
  ): boolean {
    if (!authorizationHeader?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(authorizationHeader.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator === -1) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return safeEqualString(username, stored.username) && safeEqualString(password, stored.password);
  }

  private async requireConnection(connectionId: string, provider: DevProvider): Promise<ResolvedConnection> {
    const connection = await this.resolver.resolve(connectionId);
    if (
      connection?.provider !== provider ||
      connection.authKind !== 'webhook_secret' ||
      connection.webhookSecretCiphertext === null
    )
      throw new NotFoundError('Conexão');
    return connection;
  }

  /** Vincula o evento a cada item referenciado (sempre, para a trilha) e, quando for um PR/MR
   * mergeado, tenta o auto-avanço de status (best-effort, nunca falha a ingestão do webhook). */
  private async ingest(
    connection: ResolvedConnection,
    normalized: NormalizedDevEvent | null,
  ): Promise<WebhookIngestResult> {
    if (normalized === null) return { accepted: true, linkedItemIds: [], statusAdvanced: [] };
    const references = normalized.searchableText.flatMap((text) => extractItemReferences(text));
    if (references.length === 0) return { accepted: true, linkedItemIds: [], statusAdvanced: [] };

    const statusAdvanced: string[] = [];
    const itemIds = await this.runner.run({ tenantId: connection.tenantId, userId: null, actorKind: 'api' }, async () => {
      const resolved = await this.resolveReferences(connection.tenantId, connection.workspaceId, references);
      for (const itemId of resolved) {
        const [item] = await this.runner.tx
          .select({ id: items.id, boardId: items.boardId })
          .from(items)
          .where(eq(items.id, itemId));
        if (item === undefined) continue;
        await this.runner.tx.insert(devEventLinks).values({
          tenantId: connection.tenantId,
          itemId: item.id,
          connectionId: connection.id,
          boardId: item.boardId,
          kind: normalized.kind,
          repo: normalized.repo,
          title: normalized.title.slice(0, 500),
          url: normalized.url,
          authorName: normalized.authorName,
        });
        this.events.recordChange({
          action: 'dev_event_link.created',
          entityType: 'dev_event_link',
          entityId: null,
          boardId: item.boardId,
          itemId: item.id,
          after: { kind: normalized.kind, repo: normalized.repo, url: normalized.url },
        });
      }
      return resolved;
    });
    if (itemIds.length === 0) return { accepted: true, linkedItemIds: [], statusAdvanced: [] };

    if (normalized.kind === 'pull_request_merged') {
      const connectedBy = await resolveConnectedByUser(this.database, connection).catch(() => null);
      if (connectedBy !== null) {
        for (const itemId of itemIds) {
          const advanced = await this.tryAdvanceStatus(connection.tenantId, connectedBy, itemId);
          if (advanced) statusAdvanced.push(itemId);
        }
      }
    }
    return { accepted: true, linkedItemIds: itemIds, statusAdvanced };
  }

  /** Resolve `#token`/UUID contra o valor de alguma coluna `auto_id` dos boards do workspace (match
   * exato, case-insensitive — `item_field_index.v_text` já é gravado em minúsculas pelo trigger) e,
   * na falta disso, contra um UUID de item direto (também restrito ao workspace da conexão). */
  private async resolveReferences(
    tenantId: string,
    workspaceId: string,
    references: readonly string[],
  ): Promise<string[]> {
    const found = new Set<string>();
    const byAutoId = references.filter((ref) => !UUID_PATTERN.test(ref));
    if (byAutoId.length > 0) {
      const rows = await this.runner.tx
        .select({ itemId: itemFieldIndex.itemId, vText: itemFieldIndex.vText })
        .from(itemFieldIndex)
        .innerJoin(
          columnDefinitions,
          and(eq(columnDefinitions.boardId, itemFieldIndex.boardId), eq(columnDefinitions.key, itemFieldIndex.columnKey)),
        )
        .innerJoin(boards, eq(boards.id, itemFieldIndex.boardId))
        .where(
          and(
            eq(boards.tenantId, tenantId),
            eq(boards.workspaceId, workspaceId),
            eq(columnDefinitions.type, 'auto_id'),
          ),
        );
      const wanted = new Set(byAutoId.map((ref) => ref.toLowerCase()));
      for (const row of rows) if (row.vText !== null && wanted.has(row.vText)) found.add(row.itemId);
    }
    const byUuid = references.filter((ref) => UUID_PATTERN.test(ref));
    // Uma consulta por UUID citado (poucos por evento — uma mensagem de commit raramente cita mais de
    // um item por extenso) em vez de montar um `IN (...)` dinâmico para um caso tão raro.
    for (const ref of byUuid) {
      const [row] = await this.runner.tx
        .select({ id: items.id })
        .from(items)
        .innerJoin(boards, eq(boards.id, items.boardId))
        .where(and(eq(boards.tenantId, tenantId), eq(boards.workspaceId, workspaceId), eq(items.id, ref)));
      if (row !== undefined) found.add(row.id);
    }
    return [...found];
  }

  /** Best-effort: nunca lança — um erro de permissão/transição apenas é registrado e ignorado, já que
   * o `dev_event_links` da trilha já foi gravado independentemente disso. */
  private async tryAdvanceStatus(tenantId: string, connectedBy: string, itemId: string): Promise<boolean> {
    try {
      return await this.runner.run({ tenantId, userId: connectedBy, actorKind: 'api' }, async () => {
        const [item] = await this.runner.tx
          .select({ id: items.id, boardId: items.boardId, values: items.values })
          .from(items)
          .where(eq(items.id, itemId));
        if (item === undefined) return false;
        const statusColumns = await this.runner.tx
          .select({ id: columnDefinitions.id, key: columnDefinitions.key })
          .from(columnDefinitions)
          .where(
            and(
              eq(columnDefinitions.boardId, item.boardId),
              eq(columnDefinitions.type, 'status'),
              isNull(columnDefinitions.deletedAt),
            ),
          )
          .orderBy(columnDefinitions.position);
        if (statusColumns.length === 0) return false;
        const candidates: StatusColumnCandidate[] = [];
        for (const column of statusColumns) {
          const labels = await this.runner.tx
            .select({ id: statusLabels.id, label: statusLabels.label, category: statusLabels.category })
            .from(statusLabels)
            .where(and(eq(statusLabels.columnId, column.id), isNull(statusLabels.deletedAt)));
          const currentLabelId =
            (item.values[column.key] as { labelId?: string } | undefined)?.labelId ?? null;
          candidates.push({ columnKey: column.key, labels, currentLabelId });
        }
        const advance = pickStatusAdvance(candidates);
        if (advance === null) return false;
        const actingUser = syntheticPrincipal(tenantId, connectedBy, `dev-event:${itemId}`);
        await this.items.update(actingUser, itemId, { values: { [advance.columnKey]: { labelId: advance.labelId } } });
        return true;
      });
    } catch (error) {
      this.logger.warn(
        `Auto-avanço de status ignorado para o item ${itemId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------------- consulta ---

  async listForItem(user: AuthPrincipal, itemId: string): Promise<DevEventLinkDto[]> {
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId, values: items.values })
      .from(items)
      .where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    await this.access.assert(
      user,
      'item.read',
      { type: 'item', item: { id: item.id, boardId: item.boardId, values: item.values } },
      'Item',
    );
    const rows = await this.runner.tx
      .select()
      .from(devEventLinks)
      .where(eq(devEventLinks.itemId, itemId))
      .orderBy(devEventLinks.createdAt);
    return rows.map(toDto);
  }
}
