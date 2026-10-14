import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { phaseKind, slaEventType, slaTrackerStatus } from './_enums.js';
import { appendOnlyColumns, deletedAt, position, tenantFk, tenantTable } from './_helpers.js';
import { forms } from './forms.js';
import { workCalendars } from './planning.js';
import { boards, groups, items } from './structure.js';

/** Pipe: configuração de processo (estilo Pipefy) de um board `kind = process`. */
export const pipes = tenantTable(
  'pipes',
  {
    boardId: uuid('board_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('pipes', t.tenantId, t.boardId, boards),
    uniqueIndex('pipes_board_key')
      .on(t.boardId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Fase do pipe; cada fase corresponde a um grupo do board. */
export const phases = tenantTable(
  'phases',
  {
    pipeId: uuid('pipe_id').notNull(),
    groupId: uuid('group_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: phaseKind('kind').notNull().default('intermediate'),
    requiredColumnKeys: text('required_column_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    formId: uuid('form_id'),
    wipLimit: integer('wip_limit'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('phases', t.tenantId, t.pipeId, pipes),
    tenantFk('phases', t.tenantId, t.groupId, groups),
    tenantFk('phases', t.tenantId, t.formId, forms, 'set null'),
    uniqueIndex('phases_group_key')
      .on(t.groupId)
      .where(sql`${t.deletedAt} is null`),
    index('phases_pipe_position_idx').on(t.pipeId, t.position),
    check('phases_wip_limit', sql`${t.wipLimit} is null or ${t.wipLimit} > 0`),
  ],
);

/** Regra de transição entre fases: condições, campos obrigatórios, papéis permitidos, aprovação. */
export const phaseTransitionRules = tenantTable(
  'phase_transition_rules',
  {
    pipeId: uuid('pipe_id').notNull(),
    fromPhaseId: uuid('from_phase_id'),
    toPhaseId: uuid('to_phase_id').notNull(),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    requiredColumnKeys: text('required_column_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedRoleIds: uuid('allowed_role_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    isEnabled: boolean('is_enabled').notNull().default(true),
  },
  (t) => [
    tenantFk('phase_transition_rules', t.tenantId, t.pipeId, pipes),
    tenantFk('phase_transition_rules', t.tenantId, t.fromPhaseId, phases),
    tenantFk('phase_transition_rules', t.tenantId, t.toPhaseId, phases),
    uniqueIndex('phase_transition_rules_pair_key').on(t.pipeId, t.fromPhaseId, t.toPhaseId),
  ],
);

/** Acordo de nível de serviço aplicado a uma fase (ou ao pipe todo), opcionalmente em horas úteis. */
export const slas = tenantTable(
  'slas',
  {
    boardId: uuid('board_id').notNull(),
    pipeId: uuid('pipe_id'),
    phaseId: uuid('phase_id'),
    name: text('name').notNull(),
    targetMinutes: integer('target_minutes').notNull(),
    warningPercent: smallint('warning_percent').notNull().default(80),
    useBusinessTime: boolean('use_business_time').notNull().default(true),
    workCalendarId: uuid('work_calendar_id'),
    startCondition: jsonb('start_condition').$type<Record<string, unknown>>(),
    stopCondition: jsonb('stop_condition').$type<Record<string, unknown>>(),
    pauseCondition: jsonb('pause_condition').$type<Record<string, unknown>>(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('slas', t.tenantId, t.boardId, boards),
    tenantFk('slas', t.tenantId, t.pipeId, pipes),
    tenantFk('slas', t.tenantId, t.phaseId, phases),
    tenantFk('slas', t.tenantId, t.workCalendarId, workCalendars, 'set null'),
    check('slas_target', sql`${t.targetMinutes} > 0`),
    check('slas_warning', sql`${t.warningPercent} between 1 and 100`),
  ],
);

/** Estado corrente de um SLA para um item (consultas rápidas de "atrasados"). */
export const slaTrackers = tenantTable(
  'sla_trackers',
  {
    slaId: uuid('sla_id').notNull(),
    itemId: uuid('item_id').notNull(),
    status: slaTrackerStatus('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    warningAt: timestamp('warning_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedMinutes: integer('paused_minutes').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    tenantFk('sla_trackers', t.tenantId, t.slaId, slas),
    tenantFk('sla_trackers', t.tenantId, t.itemId, items),
    uniqueIndex('sla_trackers_sla_item_running_key')
      .on(t.slaId, t.itemId)
      .where(sql`${t.status} in ('running', 'paused')`),
    index('sla_trackers_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'running'`),
  ],
);

/** Evento de SLA (append-only): início, pausa, alerta, violação, cumprimento. */
export const slaEvents = tenantTable(
  'sla_events',
  {
    slaId: uuid('sla_id').notNull(),
    trackerId: uuid('tracker_id').notNull(),
    itemId: uuid('item_id').notNull(),
    type: slaEventType('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    elapsedMinutes: integer('elapsed_minutes').notNull().default(0),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    tenantFk('sla_events', t.tenantId, t.slaId, slas),
    tenantFk('sla_events', t.tenantId, t.trackerId, slaTrackers),
    tenantFk('sla_events', t.tenantId, t.itemId, items),
    index('sla_events_item_idx').on(t.itemId, t.occurredAt),
  ],
  appendOnlyColumns(),
);
