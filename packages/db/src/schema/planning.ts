import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { dependencyType, holidayScope, milestoneStatus, sprintState } from './_enums.js';
import { createdAt, deletedAt, position, tenantFk, tenantTable, updatedAt } from './_helpers.js';
import { tenants } from './_tenants.js';
import { boards, items } from './structure.js';

/** Dependência entre itens (FS/SS/FF/SF) com lag em dias úteis (negativo = antecipação). */
export const dependencies = tenantTable(
  'dependencies',
  {
    boardId: uuid('board_id').notNull(),
    predecessorId: uuid('predecessor_id').notNull(),
    successorId: uuid('successor_id').notNull(),
    type: dependencyType('type').notNull().default('FS'),
    lagDays: integer('lag_days').notNull().default(0),
  },
  (t) => [
    tenantFk('dependencies', t.tenantId, t.boardId, boards),
    tenantFk('dependencies', t.tenantId, t.predecessorId, items),
    tenantFk('dependencies', t.tenantId, t.successorId, items),
    uniqueIndex('dependencies_pair_key').on(t.predecessorId, t.successorId),
    index('dependencies_successor_idx').on(t.successorId),
    index('dependencies_board_idx').on(t.boardId),
    check('dependencies_not_self', sql`${t.predecessorId} <> ${t.successorId}`),
    check('dependencies_lag_range', sql`${t.lagDays} between -3650 and 3650`),
  ],
);

/** Linha de base (baseline) do cronograma de um board/projeto. */
export const baselines = tenantTable(
  'baselines',
  {
    boardId: uuid('board_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    isPrimary: boolean('is_primary').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('baselines', t.tenantId, t.boardId, boards),
    uniqueIndex('baselines_board_primary_key')
      .on(t.boardId)
      .where(sql`${t.isPrimary} and ${t.deletedAt} is null`),
  ],
);

/** Fotografia de um item no momento da baseline. */
export const baselineSnapshots = tenantTable(
  'baseline_snapshots',
  {
    baselineId: uuid('baseline_id').notNull(),
    itemId: uuid('item_id').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    durationDays: integer('duration_days'),
    progress: numeric('progress', { precision: 5, scale: 2 }),
    estimateHours: numeric('estimate_hours', { precision: 10, scale: 2 }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    tenantFk('baseline_snapshots', t.tenantId, t.baselineId, baselines),
    tenantFk('baseline_snapshots', t.tenantId, t.itemId, items),
    uniqueIndex('baseline_snapshots_baseline_item_key').on(t.baselineId, t.itemId),
  ],
);

/** Marco do projeto (pode estar vinculado a um item marcado como milestone). */
export const milestones = tenantTable(
  'milestones',
  {
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id'),
    name: text('name').notNull(),
    description: text('description'),
    dueDate: date('due_date').notNull(),
    status: milestoneStatus('status').notNull().default('pending'),
    achievedAt: timestamp('achieved_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('milestones', t.tenantId, t.boardId, boards),
    tenantFk('milestones', t.tenantId, t.itemId, items, 'set null'),
    index('milestones_board_due_idx')
      .on(t.boardId, t.dueDate)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Sprint (módulo ágil) de um board de backlog. */
export const sprints = tenantTable(
  'sprints',
  {
    boardId: uuid('board_id').notNull(),
    name: text('name').notNull(),
    goal: text('goal'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    state: sprintState('state').notNull().default('planned'),
    capacityPoints: numeric('capacity_points', { precision: 8, scale: 2 }),
    position: position('position').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('sprints', t.tenantId, t.boardId, boards),
    check('sprints_dates', sql`${t.endDate} >= ${t.startDate}`),
    uniqueIndex('sprints_board_active_key')
      .on(t.boardId)
      .where(sql`${t.state} = 'active' and ${t.deletedAt} is null`),
  ],
);

/** Calendário de trabalho: dias úteis (ISO 1=segunda … 7=domingo), jornada e localidade para feriados. */
export const workCalendars = tenantTable(
  'work_calendars',
  {
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    workingDays: smallint('working_days')
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5}'::smallint[]`),
    hoursPerDay: numeric('hours_per_day', { precision: 4, scale: 2 }).notNull().default('8'),
    workStart: time('work_start').notNull().default('09:00'),
    workEnd: time('work_end').notNull().default('18:00'),
    stateCode: text('state_code'),
    cityIbgeCode: text('city_ibge_code'),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('work_calendars_tenant_default_key')
      .on(t.tenantId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
    check('work_calendars_working_days', sql`${t.workingDays} <@ '{1,2,3,4,5,6,7}'::smallint[]`),
    check(
      'work_calendars_state_code',
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

/**
 * Feriado. `tenant_id` nulo = catálogo GLOBAL (nacionais, estaduais e municipais oficiais),
 * visível a todos e somente leitura para a aplicação. Com tenant = feriado/ponte da empresa
 * ou exceção específica de um calendário.
 */
export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_v7()`)
      .$defaultFn(newId),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    calendarId: uuid('calendar_id'),
    date: date('date').notNull(),
    name: text('name').notNull(),
    scope: holidayScope('scope').notNull(),
    stateCode: text('state_code'),
    cityIbgeCode: text('city_ibge_code'),
    isOptional: boolean('is_optional').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('holidays', t.tenantId, t.calendarId, workCalendars),
    index('holidays_date_idx').on(t.date, t.scope),
    index('holidays_tenant_date_idx')
      .on(t.tenantId, t.date)
      .where(sql`${t.tenantId} is not null`),
    check('holidays_global_scope', sql`${t.tenantId} is not null or ${t.scope} <> 'company'`),
    check(
      'holidays_locality',
      sql`(${t.scope} <> 'state' or ${t.stateCode} is not null) and (${t.scope} <> 'municipal' or ${t.cityIbgeCode} is not null)`,
    ),
  ],
);
