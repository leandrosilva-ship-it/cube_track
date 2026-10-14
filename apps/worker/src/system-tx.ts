import {
  appendAuditLog,
  appendOutboxEvent,
  schema,
  withTenant,
  type DatabaseHandle,
  type OutboxEventInput,
  type Transaction,
} from '@cube-track/db';
import {
  REALTIME_CHANNEL,
  type RealtimeEventType,
  type RealtimeTransportMessage,
} from '@cube-track/shared';
import type { Redis } from 'ioredis';

export interface SystemActor {
  kind: 'automation' | 'system';
  /** Evento que causou esta execução (cadeia de causalidade). */
  causationId: string | null;
  /** Profundidade da cadeia de automações (proteção contra loops). */
  depth: number;
  correlationId: string;
}

export interface SystemUnit {
  tx: Transaction;
  audit: (entry: {
    action: string;
    entityType: string;
    entityId: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  activity: (entry: {
    boardId: string;
    itemId: string;
    action: string;
    columnKey?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  }) => Promise<void>;
  emit: <T extends RealtimeEventType>(
    input: Omit<
      OutboxEventInput<T>,
      'tenantId' | 'actorKind' | 'causationId' | 'depth' | 'correlationId'
    >,
  ) => Promise<void>;
}

/**
 * Unidade de trabalho de processos do sistema (automações, cronograma): transação com contexto do
 * tenant (RLS), auditoria e outbox na mesma transação e publicação realtime após o commit.
 */
export async function runAsSystem<T>(
  database: DatabaseHandle,
  redis: Redis,
  tenantId: string,
  actor: SystemActor,
  work: (unit: SystemUnit) => Promise<T>,
): Promise<T> {
  const published: RealtimeTransportMessage[] = [];
  const result = await withTenant(database.db, { tenantId, userId: null }, async (tx) =>
    work({
      tx,
      audit: (entry) =>
        appendAuditLog(tx, {
          tenantId,
          actorId: null,
          actorKind: actor.kind,
          ...entry,
          requestId: actor.correlationId,
          metadata: {
            ...(entry.metadata ?? {}),
            causationId: actor.causationId,
            depth: actor.depth,
          },
        }),
      activity: async (entry) => {
        await tx.insert(schema.activityLogs).values({
          tenantId,
          boardId: entry.boardId,
          itemId: entry.itemId,
          actorId: null,
          actorKind: actor.kind,
          action: entry.action,
          entityType: 'item',
          entityId: entry.itemId,
          columnKey: entry.columnKey ?? null,
          oldValue: entry.oldValue ?? null,
          newValue: entry.newValue ?? null,
          metadata: { causationId: actor.causationId },
        });
      },
      emit: async (input) => {
        published.push(
          await appendOutboxEvent(tx, {
            ...input,
            tenantId,
            actorKind: actor.kind,
            causationId: actor.causationId,
            depth: actor.depth,
            correlationId: actor.correlationId,
          }),
        );
      },
    }),
  );
  if (published.length > 0) {
    const pipeline = redis.pipeline();
    for (const message of published) pipeline.publish(REALTIME_CHANNEL, JSON.stringify(message));
    await pipeline.exec();
  }
  return result;
}
