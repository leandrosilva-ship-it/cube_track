import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { REALTIME_EVENT_TYPES, type RealtimeEventType } from '@cube-track/shared';
import { encryptSecret } from '@cube-track/shared/crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { randomToken } from '../../../core/crypto/secrets.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { webhooks, boards } = schema;

type WebhookRow = typeof webhooks.$inferSelect;

export interface WebhookDto {
  id: string;
  workspaceId: string | null;
  boardId: string | null;
  name: string;
  url: string;
  events: string[];
  headers: Record<string, string>;
  isEnabled: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookInput {
  name: string;
  url: string;
  events: string[];
  headers?: Record<string, string> | undefined;
  isEnabled?: boolean | undefined;
}

export interface UpdateWebhookInput {
  name?: string | undefined;
  url?: string | undefined;
  events?: string[] | undefined;
  headers?: Record<string, string> | undefined;
  isEnabled?: boolean | undefined;
}

function toDto(row: WebhookRow): WebhookDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    boardId: row.boardId,
    name: row.name,
    url: row.url,
    events: row.events,
    headers: row.headers,
    isEnabled: row.isEnabled,
    consecutiveFailures: row.consecutiveFailures,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertValidEvents(events: string[]): void {
  if (events.length === 0)
    throw new ValidationError([{ path: 'body.events', message: 'Informe ao menos um evento.' }]);
  const known = new Set<string>(REALTIME_EVENT_TYPES as readonly string[]);
  const invalid = events.filter((event) => !known.has(event));
  if (invalid.length > 0) {
    throw new ValidationError([
      { path: 'body.events', message: `Eventos desconhecidos: ${invalid.join(', ')}.` },
    ]);
  }
}

/**
 * Webhooks de saída (ADR 0051): por board ou por workspace inteiro. O segredo HMAC é gerado no
 * servidor e devolvido em texto simples só na criação e na regeneração — depois fica só cifrado
 * (`secretCiphertext`), igual a um token de API. CRUD exige `webhook.manage`.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listForBoard(user: AuthPrincipal, boardId: string): Promise<WebhookDto[]> {
    await this.access.assert(user, 'webhook.manage', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.boardId, boardId), isNull(webhooks.deletedAt)))
      .orderBy(desc(webhooks.createdAt));
    return rows.map(toDto);
  }

  async listForWorkspace(user: AuthPrincipal, workspaceId: string): Promise<WebhookDto[]> {
    await this.access.assert(
      user,
      'workspace.manage',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    const rows = await this.runner.tx
      .select()
      .from(webhooks)
      .where(
        and(
          eq(webhooks.workspaceId, workspaceId),
          isNull(webhooks.boardId),
          isNull(webhooks.deletedAt),
        ),
      )
      .orderBy(desc(webhooks.createdAt));
    return rows.map(toDto);
  }

  async createForBoard(
    user: AuthPrincipal,
    boardId: string,
    input: WebhookInput,
  ): Promise<WebhookDto & { secret: string }> {
    await this.access.assert(user, 'webhook.manage', { type: 'board', id: boardId }, 'Board');
    const [board] = await this.runner.tx
      .select({ workspaceId: boards.workspaceId })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    return this.insert(user, board.workspaceId, boardId, input);
  }

  async createForWorkspace(
    user: AuthPrincipal,
    workspaceId: string,
    input: WebhookInput,
  ): Promise<WebhookDto & { secret: string }> {
    await this.access.assert(
      user,
      'workspace.manage',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    return this.insert(user, workspaceId, null, input);
  }

  async update(
    user: AuthPrincipal,
    webhookId: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookDto> {
    const existing = await this.locked(webhookId);
    await this.assertManage(user, existing.workspaceId, existing.boardId);
    if (input.events !== undefined) assertValidEvents(input.events);
    const [row] = await this.runner.tx
      .update(webhooks)
      .set({
        name: input.name ?? existing.name,
        url: input.url ?? existing.url,
        events: input.events ?? existing.events,
        headers: input.headers ?? existing.headers,
        isEnabled: input.isEnabled ?? existing.isEnabled,
        disabledAt: (input.isEnabled ?? existing.isEnabled) ? null : (existing.disabledAt ?? new Date()),
        updatedAt: new Date(),
      })
      .where(eq(webhooks.id, webhookId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar webhook');
    this.events.recordChange({
      action: 'webhook.updated',
      entityType: 'webhook',
      entityId: row.id,
      boardId: row.boardId,
      before: { isEnabled: existing.isEnabled },
      after: { isEnabled: row.isEnabled },
    });
    await this.emitChanged(user, row, row.isEnabled === existing.isEnabled ? 'updated' : row.isEnabled ? 'enabled' : 'disabled');
    return toDto(row);
  }

  async regenerateSecret(
    user: AuthPrincipal,
    webhookId: string,
  ): Promise<WebhookDto & { secret: string }> {
    const existing = await this.locked(webhookId);
    await this.assertManage(user, existing.workspaceId, existing.boardId);
    const secret = randomToken(32);
    const [row] = await this.runner.tx
      .update(webhooks)
      .set({ secretCiphertext: encryptSecret(secret, this.config.ENCRYPTION_KEY), updatedAt: new Date() })
      .where(eq(webhooks.id, webhookId))
      .returning();
    if (row === undefined) throw new Error('Falha ao regenerar segredo');
    this.events.recordChange({
      action: 'webhook.secret_regenerated',
      entityType: 'webhook',
      entityId: row.id,
      boardId: row.boardId,
    });
    await this.emitChanged(user, row, 'updated');
    return { ...toDto(row), secret };
  }

  async remove(user: AuthPrincipal, webhookId: string): Promise<void> {
    const existing = await this.locked(webhookId);
    await this.assertManage(user, existing.workspaceId, existing.boardId);
    await this.runner.tx
      .update(webhooks)
      .set({ deletedAt: new Date() })
      .where(eq(webhooks.id, webhookId));
    this.events.recordChange({
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: webhookId,
      boardId: existing.boardId,
      before: { name: existing.name },
    });
    await this.emitChanged(user, existing, 'deleted');
  }

  private async insert(
    user: AuthPrincipal,
    workspaceId: string,
    boardId: string | null,
    input: WebhookInput,
  ): Promise<WebhookDto & { secret: string }> {
    if (!input.url.startsWith('https://'))
      throw new ValidationError([{ path: 'body.url', message: 'A URL precisa ser https.' }]);
    assertValidEvents(input.events);
    const secret = randomToken(32);
    const [row] = await this.runner.tx
      .insert(webhooks)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        boardId,
        name: input.name,
        url: input.url,
        secretCiphertext: encryptSecret(secret, this.config.ENCRYPTION_KEY),
        events: input.events as RealtimeEventType[],
        headers: input.headers ?? {},
        isEnabled: input.isEnabled ?? true,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar webhook');
    this.events.recordChange({
      action: 'webhook.created',
      entityType: 'webhook',
      entityId: row.id,
      boardId: row.boardId,
      after: { name: row.name, url: row.url, events: row.events },
    });
    await this.emitChanged(user, row, 'created');
    return { ...toDto(row), secret };
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<WebhookRow, 'id' | 'workspaceId' | 'boardId'>,
    change: 'created' | 'updated' | 'deleted' | 'enabled' | 'disabled',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'webhook.changed',
      aggregateType: 'webhook',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: {
        webhookId: row.id,
        workspaceId: row.workspaceId,
        boardId: row.boardId,
        change,
      },
      actorId: user.userId,
    });
  }

  private async assertManage(
    user: AuthPrincipal,
    workspaceId: string | null,
    boardId: string | null,
  ): Promise<void> {
    if (boardId === null) {
      if (workspaceId === null) throw new Error('Webhook sem board nem workspace.');
      await this.access.assert(
        user,
        'workspace.manage',
        { type: 'workspace', id: workspaceId },
        'Workspace',
      );
    } else {
      await this.access.assert(user, 'webhook.manage', { type: 'board', id: boardId }, 'Board');
    }
  }

  private async locked(webhookId: string): Promise<WebhookRow> {
    const [row] = await this.runner.tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.id, webhookId), isNull(webhooks.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Webhook');
    return row;
  }
}
