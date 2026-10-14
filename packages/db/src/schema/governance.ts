import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { retentionAction, templateKind } from './_enums.js';
import { createdAt, deletedAt, tenantFk, tenantTable, updatedAt } from './_helpers.js';
import { tenants } from './_tenants.js';
import { workspaces } from './structure.js';

/** Cabeça da cadeia de hash de auditoria por tenant (último `chain_seq` e `hash`). */
export const auditChainHeads = pgTable('audit_chain_heads', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
  lastHash: text('last_hash'),
  updatedAt: updatedAt(),
});

/** Política de retenção por tipo de entidade (LGPD: minimização e prazos). */
export const dataRetentionPolicies = tenantTable(
  'data_retention_policies',
  {
    entityType: text('entity_type').notNull(),
    retentionDays: integer('retention_days').notNull(),
    action: retentionAction('action').notNull(),
    legalBasis: text('legal_basis'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    lastAppliedAt: timestamp('last_applied_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('data_retention_policies_entity_key').on(t.tenantId, t.entityType),
    check('data_retention_policies_days', sql`${t.retentionDays} > 0`),
  ],
);

/**
 * Template (workspace, board, item, automação, dashboard, formulário).
 * `tenant_id` nulo = template GLOBAL da plataforma (somente leitura para tenants).
 */
export const templates = pgTable(
  'templates',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_v7()`)
      .$defaultFn(newId),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id'),
    kind: templateKind('kind').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    version: integer('version').notNull().default(1),
    isPublished: boolean('is_published').notNull().default(true),
    thumbnailUrl: text('thumbnail_url'),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('templates', t.tenantId, t.workspaceId, workspaces),
    index('templates_tenant_kind_idx')
      .on(t.tenantId, t.kind)
      .where(sql`${t.deletedAt} is null`),
  ],
);
