import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, QUEUES, type DomainEventJob } from '@cube-track/shared';
import { and, desc, eq, lt } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../../core/queues/queues.module.js';
import { AccessService } from '../../access/application/access.service.js';

const { webhooks, webhookDeliveries } = schema;

type DeliveryRow = typeof webhookDeliveries.$inferSelect;

export interface WebhookDeliveryDto {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'succeeded' | 'failed' | 'dead';
  attempt: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
  /** Preenchido só na entrega original de um reenvio manual — rastreia de onde ele veio. */
  resentFromId: string | null;
}

export interface DeliveryPage {
  data: WebhookDeliveryDto[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

function toDto(row: DeliveryRow): WebhookDeliveryDto {
  const metadata = (row.payload as Record<string, unknown> | null)?.__resend as
    | { fromId?: unknown }
    | undefined;
  return {
    id: row.id,
    webhookId: row.webhookId,
    eventId: row.eventId,
    eventType: row.eventType,
    status: row.status,
    attempt: row.attempt,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
    error: row.error,
    durationMs: row.durationMs,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    resentFromId: typeof metadata?.fromId === 'string' ? metadata.fromId : null,
  };
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Log de entregas de um webhook e reenvio manual (ADR 0051/0056). O motor de entrega em si (assinatura
 * HMAC, retentativa exponencial, desabilitação por falhas consecutivas) fica inteiramente no worker
 * (`apps/worker/src/processors/webhooks.ts`) — o reenvio NÃO duplica essa lógica: só enfileira um novo
 * job de entrega (`QUEUES.webhookDeliveries`) com um `eventId` novo (gerado aqui), para criar uma linha
 * NOVA em `webhook_deliveries` em vez de sobrescrever a original (a tabela tem índice único em
 * `webhookId+eventId`, usado pelo processador para ser idempotente nas retentativas automáticas — um
 * `eventId` igual ao original faria o reenvio colidir com ela via `onConflictDoUpdate`).
 */
@Injectable()
export class WebhookDeliveriesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
  ) {}

  async list(
    user: AuthPrincipal,
    webhookId: string,
    options: { cursor?: string | undefined; limit?: number | undefined },
  ): Promise<DeliveryPage> {
    const webhook = await this.assertManage(user, webhookId);
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const rows = await this.runner.tx
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.webhookId, webhook.id),
          options.cursor === undefined ? undefined : lt(webhookDeliveries.id, options.cursor),
        ),
      )
      .orderBy(desc(webhookDeliveries.id))
      .limit(limit + 1);
    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      data: page.map(toDto),
      pageInfo: { nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null, hasNextPage },
    };
  }

  /**
   * Reenvia agora a entrega `deliveryId`: reconstrói o evento original (tipo + payload gravados na
   * entrega) e enfileira para o MESMO webhook, com um `eventId` novo — o processador de entrega grava
   * o resultado numa linha nova, nunca na original.
   */
  async resend(user: AuthPrincipal, deliveryId: string): Promise<WebhookDeliveryDto> {
    const [delivery] = await this.runner.tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    if (delivery === undefined) throw new NotFoundError('Entrega de webhook');
    const webhook = await this.assertManage(user, delivery.webhookId);

    const newEventId = newId();
    const newDeliveryId = newId();
    const event: DomainEventJob = {
      eventId: newEventId,
      tenantId: user.tenantId,
      type: delivery.eventType,
      boardId: webhook.boardId,
      itemId: null,
      actorId: user.userId,
      actorKind: 'api',
      depth: 0,
      payload: delivery.payload as Record<string, unknown>,
    };
    const [inserted] = await this.runner.tx
      .insert(webhookDeliveries)
      .values({
        id: newDeliveryId,
        tenantId: user.tenantId,
        webhookId: webhook.id,
        eventId: newEventId,
        eventType: delivery.eventType,
        payload: { ...(delivery.payload as Record<string, unknown>), __resend: { fromId: delivery.id } },
        status: 'pending',
        attempt: 0,
        createdBy: user.userId,
      })
      .returning();
    if (inserted === undefined) throw new Error('Falha ao registrar o reenvio');
    await this.queues[QUEUES.webhookDeliveries].add(
      event.type,
      { webhookId: webhook.id, event },
      { jobId: `${newEventId}.${webhook.id}` },
    );
    return toDto(inserted);
  }

  private async assertManage(
    user: AuthPrincipal,
    webhookId: string,
  ): Promise<{ id: string; boardId: string | null }> {
    const [webhook] = await this.runner.tx
      .select({ id: webhooks.id, boardId: webhooks.boardId, workspaceId: webhooks.workspaceId })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));
    if (webhook === undefined) throw new NotFoundError('Webhook');
    if (webhook.boardId === null) {
      if (webhook.workspaceId === null) throw new Error('Webhook sem board nem workspace.');
      await this.access.assert(
        user,
        'workspace.manage',
        { type: 'workspace', id: webhook.workspaceId },
        'Webhook',
      );
    } else {
      await this.access.assert(user, 'webhook.manage', { type: 'board', id: webhook.boardId }, 'Webhook');
    }
    return webhook;
  }
}
