import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { statusCategory } from './_enums.js';
import { deletedAt, position, tenantFk, tenantTable } from './_helpers.js';
import { boards } from './structure.js';

export interface ColumnPermissions {
  /** Papéis/usuários/times que podem ver a coluna (vazio = todos com acesso ao board). */
  viewers?: { roleIds?: string[]; userIds?: string[]; teamIds?: string[] };
  /** Papéis/usuários/times que podem editar a coluna (vazio = todos os editores do board). */
  editors?: { roleIds?: string[]; userIds?: string[]; teamIds?: string[] };
}

/**
 * Definição de coluna de um board. `key` é o identificador estável usado em `items.values`.
 * `binding` indica coluna vinculada a campo nativo/módulo (ex.: `item.planned_end_date`).
 * `required_when` expressa obrigatoriedade condicional (AST de filtro; ex.: obrigatório quando
 * status = Concluído ou ao entrar numa fase).
 */
export const columnDefinitions = tenantTable(
  'column_definitions',
  {
    boardId: uuid('board_id').notNull(),
    key: text('key').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    binding: text('binding'),
    isRequired: boolean('is_required').notNull().default(false),
    requiredWhen: jsonb('required_when').$type<Record<string, unknown>>(),
    permissions: jsonb('permissions').$type<ColumnPermissions>().notNull().default({}),
    position: position('position').notNull(),
    width: integer('width'),
    isSystem: boolean('is_system').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('column_definitions', t.tenantId, t.boardId, boards),
    uniqueIndex('column_definitions_board_key_key').on(t.boardId, t.key),
    index('column_definitions_board_position_idx')
      .on(t.boardId, t.position)
      .where(sql`${t.deletedAt} is null`),
    check('column_definitions_key_format', sql`${t.key} ~ '^[a-z][a-z0-9_]{1,62}$'`),
    check('column_definitions_width', sql`${t.width} is null or ${t.width} between 40 and 2000`),
  ],
);

/** Rótulo de uma coluna de status (cor, categoria para métricas e posição). */
export const statusLabels = tenantTable(
  'status_labels',
  {
    columnId: uuid('column_id').notNull(),
    label: text('label').notNull(),
    color: text('color').notNull(),
    category: statusCategory('category').notNull().default('not_started'),
    position: position('position').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('status_labels', t.tenantId, t.columnId, columnDefinitions),
    index('status_labels_column_position_idx')
      .on(t.columnId, t.position)
      .where(sql`${t.deletedAt} is null`),
    check('status_labels_color', sql`${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

/** Opção de uma coluna dropdown. */
export const dropdownOptions = tenantTable(
  'dropdown_options',
  {
    columnId: uuid('column_id').notNull(),
    label: text('label').notNull(),
    color: text('color'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('dropdown_options', t.tenantId, t.columnId, columnDefinitions),
    uniqueIndex('dropdown_options_column_label_key')
      .on(t.columnId, sql`lower(${t.label})`)
      .where(sql`${t.deletedAt} is null`),
    index('dropdown_options_column_position_idx')
      .on(t.columnId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);
