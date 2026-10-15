import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';

import {
  boardKind,
  boardVisibility,
  favoriteEntity,
  folderKind,
  lifecycleStatus,
  workspaceVisibility,
} from './_enums.js';
import { deletedAt, position, tenantFk, tenantId, tenantTable } from './_helpers.js';
import { contracts } from './contracts.js';
import { users } from './identity.js';
import { sprints, workCalendars } from './planning.js';
import { portfolios, programs } from './portfolio.js';
import { phases } from './process.js';

/** Área de trabalho: agrupa pastas, boards, dashboards e portfólios; ativa módulos opcionais (ADR 0017). */
export const workspaces = tenantTable(
  'workspaces',
  {
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    visibility: workspaceVisibility('visibility').notNull().default('open'),
    enabledModules: text('enabled_modules')
      .array()
      .notNull()
      .default(sql`'{core}'::text[]`),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    position: position('position').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('workspaces_tenant_position_idx')
      .on(t.tenantId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Pasta (aninhável) dentro de um workspace. */
export const folders = tenantTable(
  'folders',
  {
    workspaceId: uuid('workspace_id').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    color: text('color'),
    kind: folderKind('kind').notNull().default('regular'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('folders', t.tenantId, t.workspaceId, workspaces),
    foreignKey({
      name: 'folders_parent_id_fk',
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('cascade'),
    check('folders_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    index('folders_workspace_parent_position_idx')
      .on(t.workspaceId, t.parentId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Board — contêiner universal de itens. `kind` habilita capacidades:
 * `project` (cronograma, baselines, saúde), `process` (pipe com fases/SLA), `backlog` (sprints).
 * Pode pertencer a um programa e/ou portfólio (hierarquia Portfólio → Programa → Projeto).
 */
export const boards = tenantTable(
  'boards',
  {
    workspaceId: uuid('workspace_id').notNull(),
    folderId: uuid('folder_id'),
    portfolioId: uuid('portfolio_id'),
    programId: uuid('program_id'),
    kind: boardKind('kind').notNull().default('board'),
    name: text('name').notNull(),
    description: text('description'),
    /** Ícone do board (nome de ícone do catálogo da interface, ex.: `briefcase`). */
    icon: text('icon'),
    visibility: boardVisibility('visibility').notNull().default('main'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    terminology: jsonb('terminology')
      .$type<{ singular: string; plural: string }>()
      .notNull()
      .default({ singular: 'item', plural: 'itens' }),
    status: lifecycleStatus('status').notNull().default('active'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    workCalendarId: uuid('work_calendar_id'),
    contractId: uuid('contract_id'),
    /** Sequência monotônica de eventos realtime do board (architecture.md §2.5). */
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    isTemplate: boolean('is_template').notNull().default(false),
    sourceTemplateId: uuid('source_template_id'),
    position: position('position').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('boards', t.tenantId, t.workspaceId, workspaces),
    tenantFk('boards', t.tenantId, t.folderId, folders, 'set null'),
    tenantFk('boards', t.tenantId, t.portfolioId, portfolios, 'set null'),
    tenantFk('boards', t.tenantId, t.programId, programs, 'set null'),
    tenantFk('boards', t.tenantId, t.workCalendarId, workCalendars, 'set null'),
    tenantFk('boards', t.tenantId, t.contractId, contracts, 'set null'),
    check(
      'boards_dates',
      sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    index('boards_workspace_folder_position_idx')
      .on(t.workspaceId, t.folderId, t.position)
      .where(sql`${t.deletedAt} is null and ${t.archivedAt} is null`),
    index('boards_program_idx')
      .on(t.programId)
      .where(sql`${t.programId} is not null`),
    index('boards_portfolio_idx')
      .on(t.portfolioId)
      .where(sql`${t.portfolioId} is not null`),
  ],
);

/** Grupo (seção/raia) de um board. Em boards de processo, cada fase aponta para um grupo. */
export const groups = tenantTable(
  'groups',
  {
    boardId: uuid('board_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#579bfc'),
    position: position('position').notNull(),
    isCollapsed: boolean('is_collapsed').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('groups', t.tenantId, t.boardId, boards),
    unique('groups_tenant_board_id_key').on(t.tenantId, t.boardId, t.id),
    index('groups_board_position_idx')
      .on(t.boardId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/**
 * Item (unidade de trabalho). Subitem = item com `parent_item_id` (no mesmo board, 1 nível).
 * Valores de colunas customizadas em `values` (JSONB, ADR 0005); datas de projeto nativas.
 */
export const items = tenantTable(
  'items',
  {
    boardId: uuid('board_id').notNull(),
    groupId: uuid('group_id').notNull(),
    parentItemId: uuid('parent_item_id'),
    name: text('name').notNull(),
    position: position('position').notNull(),
    values: jsonb('values').$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    fieldVersions: jsonb('field_versions').$type<Record<string, number>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    description: jsonb('description').$type<Record<string, unknown>>(),
    descriptionText: text('description_text'),
    sprintId: uuid('sprint_id'),
    phaseId: uuid('phase_id'),
    phaseEnteredAt: timestamp('phase_entered_at', { withTimezone: true }),
    plannedStartDate: date('planned_start_date'),
    plannedEndDate: date('planned_end_date'),
    replannedStartDate: date('replanned_start_date'),
    replannedEndDate: date('replanned_end_date'),
    actualStartDate: date('actual_start_date'),
    actualEndDate: date('actual_end_date'),
    progress: numeric('progress', { precision: 5, scale: 2 }),
    estimateHours: numeric('estimate_hours', { precision: 10, scale: 2 }),
    isMilestone: boolean('is_milestone').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedBy: uuid('updated_by'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('items', t.tenantId, t.boardId, boards),
    foreignKey({
      name: 'items_group_id_fk',
      columns: [t.tenantId, t.boardId, t.groupId],
      foreignColumns: [groups.tenantId, groups.boardId, groups.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'items_parent_item_id_fk',
      columns: [t.tenantId, t.boardId, t.parentItemId],
      foreignColumns: [t.tenantId, t.boardId, t.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    tenantFk('items', t.tenantId, t.sprintId, sprints, 'set null'),
    tenantFk('items', t.tenantId, t.phaseId, phases, 'set null'),
    unique('items_tenant_board_id_key').on(t.tenantId, t.boardId, t.id),
    check('items_not_own_parent', sql`${t.parentItemId} is null or ${t.parentItemId} <> ${t.id}`),
    check('items_progress_range', sql`${t.progress} is null or ${t.progress} between 0 and 100`),
    check(
      'items_planned_dates',
      sql`${t.plannedEndDate} is null or ${t.plannedStartDate} is null or ${t.plannedEndDate} >= ${t.plannedStartDate}`,
    ),
    check(
      'items_replanned_dates',
      sql`${t.replannedEndDate} is null or ${t.replannedStartDate} is null or ${t.replannedEndDate} >= ${t.replannedStartDate}`,
    ),
    check(
      'items_actual_dates',
      sql`${t.actualEndDate} is null or ${t.actualStartDate} is null or ${t.actualEndDate} >= ${t.actualStartDate}`,
    ),
    // Listagem principal da Tabela/Kanban: itens ativos de nível superior por grupo e posição.
    index('items_board_group_position_idx')
      .on(t.boardId, t.groupId, t.position)
      .where(sql`${t.archivedAt} is null and ${t.deletedAt} is null and ${t.parentItemId} is null`),
    index('items_parent_position_idx')
      .on(t.parentItemId, t.position)
      .where(sql`${t.parentItemId} is not null and ${t.deletedAt} is null`),
    index('items_board_archived_idx')
      .on(t.boardId, t.archivedAt)
      .where(sql`${t.archivedAt} is not null and ${t.deletedAt} is null`),
    index('items_board_updated_idx').on(t.boardId, t.updatedAt),
    // Lixeira: itens excluídos por board (restauração em 30 dias e expurgo).
    index('items_board_deleted_idx')
      .on(t.boardId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    index('items_board_planned_end_idx')
      .on(t.boardId, t.plannedEndDate)
      .where(sql`${t.deletedAt} is null and ${t.archivedAt} is null`),
    index('items_sprint_idx')
      .on(t.sprintId)
      .where(sql`${t.sprintId} is not null`),
    index('items_values_gin_idx').using('gin', t.values.op('jsonb_path_ops')),
    index('items_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

/**
 * Projeção tipada dos valores customizados para filtro por faixa e ordenação (ADR 0005/0020).
 * Mantida por trigger a partir de `items.values`; NÃO é fonte da verdade.
 */
export const itemFieldIndex = pgTable(
  'item_field_index',
  {
    tenantId: tenantId(),
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id').notNull(),
    columnKey: text('column_key').notNull(),
    vNum: numeric('v_num'),
    vDate: date('v_date'),
    vDateEnd: date('v_date_end'),
    vText: text('v_text'),
    vBool: boolean('v_bool'),
  },
  (t) => [
    primaryKey({ name: 'item_field_index_pkey', columns: [t.itemId, t.columnKey] }),
    foreignKey({
      name: 'item_field_index_item_fk',
      columns: [t.tenantId, t.boardId, t.itemId],
      foreignColumns: [items.tenantId, items.boardId, items.id],
    })
      .onDelete('cascade')
      .onUpdate('cascade'),
    index('item_field_index_num_idx')
      .on(t.boardId, t.columnKey, t.vNum, t.itemId)
      .where(sql`${t.vNum} is not null`),
    index('item_field_index_date_idx')
      .on(t.boardId, t.columnKey, t.vDate, t.itemId)
      .where(sql`${t.vDate} is not null`),
    index('item_field_index_text_idx')
      .on(t.boardId, t.columnKey, t.vText, t.itemId)
      .where(sql`${t.vText} is not null`),
    index('item_field_index_bool_idx')
      .on(t.boardId, t.columnKey, t.vBool)
      .where(sql`${t.vBool} is not null`),
  ],
);

/** Checklist de um item (ou subitem). */
export const checklists = tenantTable(
  'checklists',
  {
    itemId: uuid('item_id').notNull(),
    title: text('title').notNull(),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('checklists', t.tenantId, t.itemId, items),
    index('checklists_item_position_idx')
      .on(t.itemId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const checklistItems = tenantTable(
  'checklist_items',
  {
    checklistId: uuid('checklist_id').notNull(),
    content: text('content').notNull(),
    isDone: boolean('is_done').notNull().default(false),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('checklist_items', t.tenantId, t.checklistId, checklists),
    index('checklist_items_checklist_position_idx')
      .on(t.checklistId, t.position)
      .where(sql`${t.deletedAt} is null`),
    check(
      'checklist_items_done_consistency',
      sql`(${t.isDone} and ${t.doneAt} is not null) or (not ${t.isDone})`,
    ),
  ],
);

/** Favorito do usuário (workspace, pasta, board, dashboard, item, portfólio, programa). */
export const favorites = tenantTable(
  'favorites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: favoriteEntity('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    position: position('position').notNull(),
  },
  (t) => [
    uniqueIndex('favorites_user_entity_key').on(t.tenantId, t.userId, t.entityType, t.entityId),
  ],
);

/** Contadores para IDs automáticos com máscara (por coluna e período de reinício). */
export const idSequences = tenantTable(
  'id_sequences',
  {
    scope: text('scope').notNull(),
    periodKey: text('period_key').notNull().default(''),
    currentValue: bigint('current_value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    uniqueIndex('id_sequences_scope_period_key').on(t.tenantId, t.scope, t.periodKey),
    check('id_sequences_non_negative', sql`${t.currentValue} >= 0`),
  ],
);
