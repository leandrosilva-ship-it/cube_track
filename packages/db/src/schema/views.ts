import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { shareResource, viewType } from './_enums.js';
import { deletedAt, position, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards } from './structure.js';

/**
 * View salva de um board. `config` é específico do tipo (ex.: Kanban `{ columnsBy, swimlanesBy }`),
 * `filters` é a AST tipada de filtro (ADR 0005), `sort`/`groupBy` listas ordenadas.
 * View pessoal: `owner_id` preenchido; compartilhada: `owner_id` nulo.
 */
export const views = tenantTable(
  'views',
  {
    boardId: uuid('board_id').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    type: viewType('type').notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    filters: jsonb('filters').$type<Record<string, unknown>>(),
    sort: jsonb('sort')
      .$type<{ columnKey: string; direction: 'asc' | 'desc' }[]>()
      .notNull()
      .default([]),
    groupBy: jsonb('group_by').$type<Record<string, unknown>>(),
    hiddenColumnKeys: text('hidden_column_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isDefault: boolean('is_default').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('views', t.tenantId, t.boardId, boards),
    index('views_board_position_idx')
      .on(t.boardId, t.position)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('views_board_default_key')
      .on(t.boardId)
      .where(sql`${t.isDefault} and ${t.ownerId} is null and ${t.deletedAt} is null`),
  ],
);

/** Filtro salvo reutilizável (pessoal ou compartilhado no board). */
export const savedFilters = tenantTable(
  'saved_filters',
  {
    boardId: uuid('board_id').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filter: jsonb('filter').$type<Record<string, unknown>>().notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('saved_filters', t.tenantId, t.boardId, boards),
    index('saved_filters_board_idx')
      .on(t.boardId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Link público somente leitura (board, view, dashboard ou formulário).
 * O token nunca é armazenado em claro (`token_hash` = SHA-256); senha opcional (hash Argon2id).
 * Resolução sem contexto de tenant via função `app.resolve_share_link` (SECURITY DEFINER).
 */
export const shareLinks = tenantTable(
  'share_links',
  {
    resourceType: shareResource('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    accessCount: integer('access_count').notNull().default(0),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('share_links_token_hash_key').on(t.tokenHash),
    index('share_links_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
    check('share_links_token_hash_len', sql`char_length(${t.tokenHash}) = 64`),
  ],
);
