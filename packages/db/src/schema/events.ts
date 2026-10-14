import { sql } from 'drizzle-orm';
import { bigint, index, jsonb, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { actorKind } from './_enums.js';
import { appendOnlyColumns, tenantTable } from './_helpers.js';

/**
 * Outbox transacional (ADR 0012/0027): todo evento de domínio é gravado na mesma transação da
 * mudança. Também serve de log de replay realtime por board (`board_id`, `seq`), com retenção curta.
 */
export const outboxEvents = tenantTable(
  'outbox_events',
  {
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    /** Usuário destinatário de eventos pessoais (room `u:`). */
    userId: uuid('user_id'),
    seq: bigint('seq', { mode: 'number' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    /** Metadados internos (ex.: responsáveis do item) usados no filtro de fan-out; nunca enviados. */
    routing: jsonb('routing').$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid('actor_id'),
    actorKind: actorKind('actor_kind').notNull().default('user'),
    correlationId: text('correlation_id'),
    causationId: uuid('causation_id'),
    depth: smallint('depth').notNull().default(0),
    clientMutationId: text('client_mutation_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    index('outbox_events_unpublished_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
    index('outbox_events_board_seq_idx')
      .on(t.boardId, t.seq)
      .where(sql`${t.boardId} is not null`),
  ],
  appendOnlyColumns(),
);
