import { HealthRuleSchema } from '@cube-track/shared';
import { z } from 'zod';

export const ScoringCriterionSchema = z
  .object({
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    weight: z.number().positive(),
    scaleMin: z.number(),
    scaleMax: z.number(),
    higherIsBetter: z.boolean(),
  })
  .strict();

const lifecycleStatusEnum = z.enum(['proposed', 'planning', 'active', 'on_hold', 'completed', 'cancelled']);
const healthStatusEnum = z.enum(['green', 'yellow', 'red', 'grey']);
const gateStatusEnum = z.enum(['pending', 'approved', 'rejected', 'skipped']);
const riskStatusEnum = z.enum(['open', 'mitigating', 'occurred', 'closed']);
const riskStrategyEnum = z.enum(['avoid', 'mitigate', 'transfer', 'accept']);
const issueSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);
const issueStatusEnum = z.enum(['open', 'in_progress', 'resolved', 'closed']);
const budgetCategoryEnum = z.enum(['capex', 'opex']);
const costKindEnum = z.enum(['planned', 'actual', 'forecast']);
const costSourceEnum = z.enum(['manual', 'timesheet', 'invoice', 'import']);
const amount = z.string().regex(/^\d+(\.\d{1,4})?$/, 'Valor inválido.');
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD).');

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const PortfolioParams = z.object({ portfolioId: z.uuid() });
export const ProgramParams = z.object({ programId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });
export const IdParams = z.object({ id: z.uuid() });

// ------------------------------------------------------------------------------- portfólios ---

export const PortfolioSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  folderId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  scoringModelId: z.uuid().nullable(),
  status: lifecycleStatusEnum,
});
export const CreatePortfolioBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4_000).nullable().optional(),
    folderId: z.uuid().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    scoringModelId: z.uuid().nullable().optional(),
    status: lifecycleStatusEnum.optional(),
  })
  .strict();
export const UpdatePortfolioBody = CreatePortfolioBody.partial();

// --------------------------------------------------------------------------------- programas ---

export const ProgramSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  portfolioId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  status: lifecycleStatusEnum,
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});
export const CreateProgramBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(4_000).nullable().optional(),
    portfolioId: z.uuid().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    status: lifecycleStatusEnum.optional(),
    startDate: dateString.nullable().optional(),
    endDate: dateString.nullable().optional(),
  })
  .strict();
export const UpdateProgramBody = CreateProgramBody.partial();

// ------------------------------------------------------------------------------- priorização ---

export const ScoringModelSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  method: z.enum(['weighted', 'wsjf']),
  criteria: z.array(ScoringCriterionSchema),
  isDefault: z.boolean(),
});
export const CreateScoringModelBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2_000).nullable().optional(),
    method: z.enum(['weighted', 'wsjf']).optional(),
    criteria: z.array(ScoringCriterionSchema).min(1).max(20),
    isDefault: z.boolean().optional(),
  })
  .strict();
export const UpdateScoringModelBody = CreateScoringModelBody.partial();

export const ScoreSchema = z.object({
  id: z.uuid(),
  scoringModelId: z.uuid(),
  boardId: z.uuid(),
  criteriaScores: z.record(z.string(), z.number()),
  totalScore: z.string(),
  scoredBy: z.uuid().nullable(),
  scoredAt: z.string(),
  rationale: z.string().nullable(),
});
export const SetScoreBody = z
  .object({
    scoringModelId: z.uuid(),
    criteriaScores: z.record(z.string(), z.number()),
    rationale: z.string().max(2_000).nullable().optional(),
  })
  .strict();

export const ValueEffortPointSchema = z.object({
  boardId: z.uuid(),
  boardName: z.string(),
  value: z.number(),
  effort: z.number(),
  quadrant: z.enum(['quick_win', 'major_project', 'fill_in', 'thankless_task']),
});
export const RankingEntrySchema = z.object({
  boardId: z.uuid(),
  boardName: z.string(),
  score: z.number(),
});

// -------------------------------------------------------------------------------- stage gates ---

export const StageGateSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  position: z.string(),
  status: gateStatusEnum,
  dueDate: z.string().nullable(),
  criteria: z.array(z.object({ label: z.string(), met: z.boolean() })),
  decidedBy: z.uuid().nullable(),
  decidedAt: z.string().nullable(),
  notes: z.string().nullable(),
});
export const CreateStageGateBody = z
  .object({
    name: z.string().min(1).max(200),
    dueDate: dateString.nullable().optional(),
    criteria: z.array(z.object({ label: z.string().min(1).max(200), met: z.boolean() })).max(50).optional(),
  })
  .strict();
export const UpdateStageGateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    dueDate: dateString.nullable().optional(),
    criteria: z.array(z.object({ label: z.string().min(1).max(200), met: z.boolean() })).max(50).optional(),
    notes: z.string().max(2_000).nullable().optional(),
  })
  .strict();
export const DecideStageGateBody = z
  .object({ status: z.enum(['approved', 'rejected', 'skipped']), notes: z.string().max(2_000).nullable().optional() })
  .strict();
export const ReorderStageGatesBody = z.object({ orderedIds: z.array(z.uuid()).min(1).max(50) }).strict();

// -------------------------------------------------------------------------------------- riscos ---

export const RiskSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  itemId: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  probability: z.number().int(),
  impact: z.number().int(),
  status: riskStatusEnum,
  strategy: riskStrategyEnum.nullable(),
  mitigationPlan: z.string().nullable(),
  contingencyPlan: z.string().nullable(),
  ownerId: z.uuid().nullable(),
  dueDate: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export const CreateRiskBody = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4_000).nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    itemId: z.uuid().nullable().optional(),
    probability: z.number().int().min(1).max(5),
    impact: z.number().int().min(1).max(5),
    strategy: riskStrategyEnum.nullable().optional(),
    mitigationPlan: z.string().max(4_000).nullable().optional(),
    contingencyPlan: z.string().max(4_000).nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    dueDate: dateString.nullable().optional(),
  })
  .strict();
export const UpdateRiskBody = CreateRiskBody.partial().extend({
  status: riskStatusEnum.optional(),
});

// -------------------------------------------------------------------------------- problemas ---

export const IssueSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  itemId: z.uuid().nullable(),
  riskId: z.uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  severity: issueSeverityEnum,
  status: issueStatusEnum,
  ownerId: z.uuid().nullable(),
  dueDate: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolution: z.string().nullable(),
});
export const CreateIssueBody = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(4_000).nullable().optional(),
    itemId: z.uuid().nullable().optional(),
    riskId: z.uuid().nullable().optional(),
    severity: issueSeverityEnum.optional(),
    ownerId: z.uuid().nullable().optional(),
    dueDate: dateString.nullable().optional(),
  })
  .strict();
export const UpdateIssueBody = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4_000).nullable().optional(),
    severity: issueSeverityEnum.optional(),
    status: issueStatusEnum.optional(),
    ownerId: z.uuid().nullable().optional(),
    dueDate: dateString.nullable().optional(),
    resolution: z.string().max(4_000).nullable().optional(),
  })
  .strict();

// ------------------------------------------------------------------------------- orçamentos ---

export const BudgetSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid().nullable(),
  programId: z.uuid().nullable(),
  portfolioId: z.uuid().nullable(),
  name: z.string(),
  category: budgetCategoryEnum,
  currency: z.string(),
  plannedAmount: z.string(),
  fiscalYear: z.number().int().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
});
export const CreateBudgetBody = z
  .object({
    name: z.string().min(1).max(200),
    category: budgetCategoryEnum.optional(),
    currency: z.string().length(3).optional(),
    plannedAmount: amount,
    fiscalYear: z.number().int().min(2000).max(2200).nullable().optional(),
    periodStart: dateString.nullable().optional(),
    periodEnd: dateString.nullable().optional(),
  })
  .strict();
export const UpdateBudgetBody = CreateBudgetBody.partial();

export const CostEntrySchema = z.object({
  id: z.uuid(),
  budgetId: z.uuid(),
  boardId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  entryDate: z.string(),
  amount: z.string(),
  currency: z.string(),
  kind: costKindEnum,
  source: costSourceEnum,
  category: z.string().nullable(),
  description: z.string().nullable(),
  reference: z.string().nullable(),
});
export const CreateCostEntryBody = z
  .object({
    entryDate: dateString,
    amount,
    currency: z.string().length(3).optional(),
    kind: costKindEnum.optional(),
    itemId: z.uuid().nullable().optional(),
    category: z.string().max(100).nullable().optional(),
    description: z.string().max(2_000).nullable().optional(),
    reference: z.string().max(200).nullable().optional(),
  })
  .strict();
export const UpdateCostEntryBody = CreateCostEntryBody.partial();

// -------------------------------------------------------------------------------- saúde/RAG ---

export const HealthRuleSetResponseSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid().nullable(),
  rules: z.array(HealthRuleSchema),
});
export const SetHealthRuleSetBody = z.object({ rules: z.array(HealthRuleSchema).max(50) }).strict();

// --------------------------------------------------------------------------------- rollup ---

export const RollupResponseSchema = z.object({
  boardCount: z.number(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  percentComplete: z.number(),
  plannedCost: z.number(),
  actualCost: z.number(),
  forecastCost: z.number(),
  ustTotal: z.number(),
  openRisks: z.number(),
  criticalRisks: z.number(),
  overall: healthStatusEnum,
});

// --------------------------------------------------------------------------------- what-if ---

export const WhatIfChangeSchema = z.object({
  boardId: z.uuid(),
  action: z.enum(['include', 'exclude', 'delay']),
  delayDays: z.number().int().optional(),
});
export const WhatIfBody = z
  .object({ scope: z.enum(['portfolio', 'program']), id: z.uuid(), changes: z.array(WhatIfChangeSchema).max(100) })
  .strict();
export const WhatIfResponseSchema = z.object({
  baseline: z.object({ activeProjects: z.number(), totalPlannedCost: z.number(), latestEndDate: z.string().nullable() }),
  simulated: z.object({ activeProjects: z.number(), totalPlannedCost: z.number(), latestEndDate: z.string().nullable() }),
});

// --------------------------------------------------------------------------- status report ---

export const BoardStatusReportSchema = z.object({
  boardId: z.uuid(),
  boardName: z.string(),
  health: z.object({ latest: z.unknown().nullable(), history: z.array(z.unknown()) }),
  percentComplete: z.number(),
  evm: z.object({ pv: z.number(), ev: z.number(), ac: z.number(), spi: z.number().nullable(), cpi: z.number().nullable(), eac: z.number(), vac: z.number() }),
  budget: z.object({ plannedAmount: z.number(), actualAmount: z.number(), forecastAmount: z.number() }),
  openRisks: z.array(RiskSchema),
  openIssues: z.array(IssueSchema),
  stageGates: z.array(StageGateSchema),
});
