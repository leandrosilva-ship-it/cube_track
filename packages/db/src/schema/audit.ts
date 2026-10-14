import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { actorKind } from './_enums.js';

/**
 * Trilha de auditoria de compliance (ADR 0015).
 *
 * Tabela PARTICIONADA por mês (`created_at`), criada por SQL manual na migração
 * `0002_rls_and_triggers` e fora do conjunto de arquivos lidos pelo drizzle-kit (`drizzle.config.ts`).
 * Append-only: UPDATE/DELETE/TRUNCATE revogados e bloqueados por trigger.
 * `hash = sha256(prev_hash || conteúdo canônico)`, encadeado por tenant via `chain_seq`.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .notNull()
      .default(sql`app.uuid_v7()`)
      .$defaultFn(newId),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    actorKind: actorKind('actor_kind').notNull().default('user'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    chainSeq: bigint('chain_seq', { mode: 'number' }).notNull(),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
  },
  (t) => [
    primaryKey({ name: 'audit_logs_pkey', columns: [t.id, t.createdAt] }),
    index('audit_logs_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId, t.createdAt),
    index('audit_logs_tenant_actor_idx').on(t.tenantId, t.createdBy, t.createdAt),
  ],
);
