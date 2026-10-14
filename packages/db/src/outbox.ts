import {
  newId,
  type EventRouting,
  type RealtimeEvent,
  type RealtimeEventPayload,
  type RealtimeEventType,
  type RealtimeTransportMessage,
} from '@cube-track/shared';
import { sql } from 'drizzle-orm';

import type { Transaction } from './client.js';
import { outboxEvents } from './schema/index.js';

export interface OutboxEventInput<T extends RealtimeEventType = RealtimeEventType> {
  tenantId: string;
  type: T;
  aggregateType: string;
  aggregateId: string;
  payload: RealtimeEventPayload<T>;
  boardId?: string | null;
  itemId?: string | null;
  userId?: string | null;
  dashboardId?: string | null;
  routing?: EventRouting;
  actorId?: string | null;
  actorKind?: RealtimeEvent['actor']['kind'];
  correlationId?: string | null;
  causationId?: string | null;
  depth?: number;
  clientMutationId?: string | null;
}

/**
 * Grava um evento no outbox na transação corrente (ADR 0012/0027). Eventos de board recebem a
 * próxima sequência do board (`boards.seq`), o que serializa escritas concorrentes no mesmo board.
 * Retorna a mensagem pronta para publicação realtime após o commit (fast path).
 */
export async function appendOutboxEvent<T extends RealtimeEventType>(
  tx: Transaction,
  input: OutboxEventInput<T>,
): Promise<RealtimeTransportMessage> {
  const boardId = input.boardId ?? null;
  let seq: number | null = null;
  if (boardId !== null) {
    const result = await tx.execute<{ seq: string }>(
      sql`update boards set seq = seq + 1 where id = ${boardId}::uuid returning seq`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Board inexistente para evento: ${boardId}`);
    seq = Number(row.seq);
  }
  const eventId = newId();
  const occurredAt = new Date();
  const routing = input.routing ?? {};
  await tx.insert(outboxEvents).values({
    id: eventId,
    tenantId: input.tenantId,
    eventType: input.type,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    boardId,
    itemId: input.itemId ?? null,
    userId: input.userId ?? null,
    seq,
    payload: input.payload as Record<string, unknown>,
    routing: { ...routing, dashboardId: input.dashboardId ?? null },
    actorId: input.actorId ?? null,
    actorKind: input.actorKind ?? 'user',
    correlationId: input.correlationId ?? null,
    causationId: input.causationId ?? null,
    depth: input.depth ?? 0,
    clientMutationId: input.clientMutationId ?? null,
    createdAt: occurredAt,
    createdBy: input.actorId ?? null,
  });
  return {
    event: {
      eventId,
      type: input.type,
      tenantId: input.tenantId,
      scope: {
        boardId,
        itemId: input.itemId ?? null,
        userId: input.userId ?? null,
        dashboardId: input.dashboardId ?? null,
      },
      seq,
      actor: { userId: input.actorId ?? null, kind: input.actorKind ?? 'user' },
      clientMutationId: input.clientMutationId ?? null,
      occurredAt: occurredAt.toISOString(),
      payload: input.payload,
      schemaVersion: 1,
    },
    routing,
  };
}

/** Reconstrói a mensagem de transporte a partir de uma linha do outbox (replay/relay). */
export function outboxRowToMessage(
  row: typeof outboxEvents.$inferSelect,
): RealtimeTransportMessage {
  const { dashboardId, ...routing } = row.routing as EventRouting & { dashboardId?: string | null };
  return {
    event: {
      eventId: row.id,
      type: row.eventType as RealtimeEventType,
      tenantId: row.tenantId,
      scope: {
        boardId: row.boardId,
        itemId: row.itemId,
        userId: row.userId,
        dashboardId: dashboardId ?? null,
      },
      seq: row.seq,
      actor: { userId: row.actorId, kind: row.actorKind },
      clientMutationId: row.clientMutationId,
      occurredAt: row.createdAt.toISOString(),
      payload: row.payload as RealtimeEvent['payload'],
      schemaVersion: 1,
    },
    routing,
  };
}
