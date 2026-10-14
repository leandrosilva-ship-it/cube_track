import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  budgetCategory,
  costKind,
  costSource,
  gateStatus,
  healthStatus,
  issueSeverity,
  issueStatus,
  lifecycleStatus,
  riskStatus,
  riskStrategy,
} from './_enums.js';
import { deletedAt, MONEY, position, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, folders, items, workspaces } from './structure.js';

export interface ScoringCriterion {
  key: string;
  label: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  higherIsBetter: boolean;
}

/** Modelo de pontuação (priorização) com critérios ponderados. */
export const scoringModels = tenantTable(
  'scoring_models',
  {
    name: text('name').notNull(),
    description: text('description'),
    criteria: jsonb('criteria').$type<ScoringCriterion[]>().notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [
    check('scoring_models_criteria_array', sql`jsonb_typeof(${t.criteria}) = 'array'`),
    uniqueIndex('scoring_models_tenant_default_key')
      .on(t.tenantId)
      .where(sql`${t.isDefault} and ${t.deletedAt} is null`),
  ],
);

/** Portfólio: agrega programas e projetos para priorização e visão executiva. */
export const portfolios = tenantTable(
  'portfolios',
  {
    workspaceId: uuid('workspace_id').notNull(),
    folderId: uuid('folder_id'),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    scoringModelId: uuid('scoring_model_id'),
    status: lifecycleStatus('status').notNull().default('active'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('portfolios', t.tenantId, t.workspaceId, workspaces),
    tenantFk('portfolios', t.tenantId, t.folderId, folders, 'set null'),
    tenantFk('portfolios', t.tenantId, t.scoringModelId, scoringModels, 'set null'),
    index('portfolios_workspace_idx')
      .on(t.workspaceId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Programa: conjunto de projetos relacionados, opcionalmente dentro de um portfólio. */
export const programs = tenantTable(
  'programs',
  {
    workspaceId: uuid('workspace_id').notNull(),
    portfolioId: uuid('portfolio_id'),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    status: lifecycleStatus('status').notNull().default('active'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('programs', t.tenantId, t.workspaceId, workspaces),
    tenantFk('programs', t.tenantId, t.portfolioId, portfolios, 'set null'),
    index('programs_portfolio_idx')
      .on(t.portfolioId)
      .where(sql`${t.deletedAt} is null`),
    check(
      'programs_dates',
      sql`${t.endDate} is null or ${t.startDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
  ],
);

/** Relato de saúde do projeto (Project Health) — série histórica. */
export const projectHealth = tenantTable(
  'project_health',
  {
    boardId: uuid('board_id').notNull(),
    reportedBy: uuid('reported_by').references(() => users.id, { onDelete: 'set null' }),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    overall: healthStatus('overall').notNull(),
    schedule: healthStatus('schedule').notNull().default('grey'),
    cost: healthStatus('cost').notNull().default('grey'),
    scope: healthStatus('scope').notNull().default('grey'),
    quality: healthStatus('quality').notNull().default('grey'),
    risk: healthStatus('risk').notNull().default('grey'),
    percentComplete: numeric('percent_complete', { precision: 5, scale: 2 }),
    spi: numeric('spi', { precision: 6, scale: 3 }),
    cpi: numeric('cpi', { precision: 6, scale: 3 }),
    summary: text('summary'),
  },
  (t) => [
    tenantFk('project_health', t.tenantId, t.boardId, boards),
    index('project_health_board_reported_idx').on(t.boardId, t.reportedAt),
    check(
      'project_health_percent',
      sql`${t.percentComplete} is null or ${t.percentComplete} between 0 and 100`,
    ),
  ],
);

/** Pontuação de um projeto num modelo de scoring. */
export const scores = tenantTable(
  'scores',
  {
    scoringModelId: uuid('scoring_model_id').notNull(),
    boardId: uuid('board_id').notNull(),
    criteriaScores: jsonb('criteria_scores').$type<Record<string, number>>().notNull(),
    totalScore: numeric('total_score', { precision: 10, scale: 4 }).notNull(),
    scoredBy: uuid('scored_by').references(() => users.id, { onDelete: 'set null' }),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
    rationale: text('rationale'),
  },
  (t) => [
    tenantFk('scores', t.tenantId, t.scoringModelId, scoringModels),
    tenantFk('scores', t.tenantId, t.boardId, boards),
    uniqueIndex('scores_model_board_key').on(t.scoringModelId, t.boardId),
  ],
);

/** Stage gate (portão de decisão) do ciclo de vida do projeto. */
export const stageGates = tenantTable(
  'stage_gates',
  {
    boardId: uuid('board_id').notNull(),
    name: text('name').notNull(),
    position: position('position').notNull(),
    status: gateStatus('status').notNull().default('pending'),
    dueDate: date('due_date'),
    criteria: jsonb('criteria').$type<{ label: string; met: boolean }[]>().notNull().default([]),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [
    tenantFk('stage_gates', t.tenantId, t.boardId, boards),
    index('stage_gates_board_position_idx').on(t.boardId, t.position),
  ],
);

/** Risco (probabilidade × impacto, escala 1–5). */
export const risks = tenantTable(
  'risks',
  {
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id'),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'),
    probability: smallint('probability').notNull(),
    impact: smallint('impact').notNull(),
    status: riskStatus('status').notNull().default('open'),
    strategy: riskStrategy('strategy'),
    mitigationPlan: text('mitigation_plan'),
    contingencyPlan: text('contingency_plan'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('risks', t.tenantId, t.boardId, boards),
    tenantFk('risks', t.tenantId, t.itemId, items, 'set null'),
    index('risks_board_status_idx')
      .on(t.boardId, t.status)
      .where(sql`${t.deletedAt} is null`),
    check('risks_probability', sql`${t.probability} between 1 and 5`),
    check('risks_impact', sql`${t.impact} between 1 and 5`),
  ],
);

/** Problema (issue) do projeto, opcionalmente originado de um risco. */
export const issues = tenantTable(
  'issues',
  {
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id'),
    riskId: uuid('risk_id'),
    title: text('title').notNull(),
    description: text('description'),
    severity: issueSeverity('severity').notNull().default('medium'),
    status: issueStatus('status').notNull().default('open'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('issues', t.tenantId, t.boardId, boards),
    tenantFk('issues', t.tenantId, t.itemId, items, 'set null'),
    tenantFk('issues', t.tenantId, t.riskId, risks, 'set null'),
    index('issues_board_status_idx')
      .on(t.boardId, t.status)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Orçamento de projeto, programa ou portfólio. */
export const budgets = tenantTable(
  'budgets',
  {
    boardId: uuid('board_id'),
    programId: uuid('program_id'),
    portfolioId: uuid('portfolio_id'),
    name: text('name').notNull(),
    category: budgetCategory('category').notNull().default('opex'),
    currency: text('currency').notNull().default('BRL'),
    plannedAmount: numeric('planned_amount', MONEY).notNull(),
    fiscalYear: integer('fiscal_year'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('budgets', t.tenantId, t.boardId, boards),
    tenantFk('budgets', t.tenantId, t.programId, programs),
    tenantFk('budgets', t.tenantId, t.portfolioId, portfolios),
    check(
      'budgets_single_owner',
      sql`num_nonnulls(${t.boardId}, ${t.programId}, ${t.portfolioId}) = 1`,
    ),
    check('budgets_amount', sql`${t.plannedAmount} >= 0`),
  ],
);

/** Lançamento de custo (planejado, real ou previsão) contra um orçamento. */
export const costEntries = tenantTable(
  'cost_entries',
  {
    budgetId: uuid('budget_id').notNull(),
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    entryDate: date('entry_date').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    currency: text('currency').notNull().default('BRL'),
    kind: costKind('kind').notNull().default('actual'),
    source: costSource('source').notNull().default('manual'),
    category: text('category'),
    description: text('description'),
    reference: text('reference'),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('cost_entries', t.tenantId, t.budgetId, budgets),
    tenantFk('cost_entries', t.tenantId, t.boardId, boards, 'set null'),
    tenantFk('cost_entries', t.tenantId, t.itemId, items, 'set null'),
    index('cost_entries_budget_date_idx')
      .on(t.budgetId, t.entryDate)
      .where(sql`${t.deletedAt} is null`),
  ],
);
