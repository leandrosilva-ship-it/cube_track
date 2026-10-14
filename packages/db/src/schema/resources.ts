import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  absenceType,
  allocationStatus,
  approvalStatus,
  resourceRequestStatus,
  timeEntrySource,
} from './_enums.js';
import { deletedAt, MONEY, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { workCalendars } from './planning.js';
import { boards, items } from './structure.js';

/** Perfil de recurso de um usuário no tenant: capacidade, custos e calendário. */
export const resourceProfiles = tenantTable(
  'resource_profiles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobTitle: text('job_title'),
    department: text('department'),
    managerId: uuid('manager_id').references(() => users.id, { onDelete: 'set null' }),
    capacityHoursPerWeek: numeric('capacity_hours_per_week', { precision: 5, scale: 2 })
      .notNull()
      .default('40'),
    costRateHour: numeric('cost_rate_hour', MONEY),
    billRateHour: numeric('bill_rate_hour', MONEY),
    workCalendarId: uuid('work_calendar_id'),
    location: text('location'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('resource_profiles', t.tenantId, t.workCalendarId, workCalendars, 'set null'),
    uniqueIndex('resource_profiles_tenant_user_key').on(t.tenantId, t.userId),
    check('resource_profiles_capacity', sql`${t.capacityHoursPerWeek} between 0 and 168`),
  ],
);

export const skills = tenantTable(
  'skills',
  {
    name: text('name').notNull(),
    category: text('category'),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('skills_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`)],
);

/** Competência de um usuário com nível de 1 (básico) a 5 (especialista). */
export const userSkills = tenantTable(
  'user_skills',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').notNull(),
    level: smallint('level').notNull(),
  },
  (t) => [
    tenantFk('user_skills', t.tenantId, t.skillId, skills),
    uniqueIndex('user_skills_user_skill_key').on(t.tenantId, t.userId, t.skillId),
    check('user_skills_level', sql`${t.level} between 1 and 5`),
  ],
);

/** Alocação planejada de um usuário em um board/item por período. */
export const allocations = tenantTable(
  'allocations',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    hoursPerDay: numeric('hours_per_day', { precision: 4, scale: 2 }).notNull(),
    status: allocationStatus('status').notNull().default('confirmed'),
    notes: text('notes'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('allocations', t.tenantId, t.boardId, boards),
    tenantFk('allocations', t.tenantId, t.itemId, items),
    index('allocations_user_period_idx')
      .on(t.tenantId, t.userId, t.startDate, t.endDate)
      .where(sql`${t.deletedAt} is null`),
    index('allocations_board_idx').on(t.boardId),
    check('allocations_dates', sql`${t.endDate} >= ${t.startDate}`),
    check('allocations_hours', sql`${t.hoursPerDay} > 0 and ${t.hoursPerDay} <= 24`),
  ],
);

/** Ausência (férias, licença, treinamento, folga). */
export const absences = tenantTable(
  'absences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: absenceType('type').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    hoursPerDay: numeric('hours_per_day', { precision: 4, scale: 2 }),
    status: approvalStatus('status').notNull().default('submitted'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('absences_user_period_idx').on(t.tenantId, t.userId, t.startDate, t.endDate),
    check('absences_dates', sql`${t.endDate} >= ${t.startDate}`),
  ],
);

/** Aprovação de timesheet por usuário e período. */
export const timesheetApprovals = tenantTable(
  'timesheet_approvals',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: approvalStatus('status').notNull().default('draft'),
    totalMinutes: integer('total_minutes').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    comment: text('comment'),
  },
  (t) => [
    uniqueIndex('timesheet_approvals_user_period_key').on(t.tenantId, t.userId, t.periodStart),
    check('timesheet_approvals_dates', sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/** Apontamento de horas em um item. */
export const timeEntries = tenantTable(
  'time_entries',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id').notNull(),
    entryDate: date('entry_date').notNull(),
    minutes: integer('minutes').notNull(),
    description: text('description'),
    isBillable: boolean('is_billable').notNull().default(true),
    source: timeEntrySource('source').notNull().default('manual'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: approvalStatus('status').notNull().default('draft'),
    approvalId: uuid('approval_id'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('time_entries', t.tenantId, t.boardId, boards),
    tenantFk('time_entries', t.tenantId, t.itemId, items),
    tenantFk('time_entries', t.tenantId, t.approvalId, timesheetApprovals, 'set null'),
    index('time_entries_user_date_idx')
      .on(t.tenantId, t.userId, t.entryDate)
      .where(sql`${t.deletedAt} is null`),
    index('time_entries_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    check('time_entries_minutes', sql`${t.minutes} > 0 and ${t.minutes} <= 1440`),
    check(
      'time_entries_interval',
      sql`${t.endedAt} is null or ${t.startedAt} is null or ${t.endedAt} > ${t.startedAt}`,
    ),
  ],
);

/** Solicitação de recurso (perfil/competência) para um projeto. */
export const resourceRequests = tenantTable(
  'resource_requests',
  {
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id'),
    skillId: uuid('skill_id'),
    roleTitle: text('role_title').notNull(),
    hours: numeric('hours', { precision: 8, scale: 2 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: resourceRequestStatus('status').notNull().default('open'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
  },
  (t) => [
    tenantFk('resource_requests', t.tenantId, t.boardId, boards),
    tenantFk('resource_requests', t.tenantId, t.itemId, items, 'set null'),
    tenantFk('resource_requests', t.tenantId, t.skillId, skills, 'set null'),
    index('resource_requests_status_idx').on(t.tenantId, t.status),
    check('resource_requests_dates', sql`${t.endDate} >= ${t.startDate}`),
    check('resource_requests_hours', sql`${t.hours} > 0`),
  ],
);
