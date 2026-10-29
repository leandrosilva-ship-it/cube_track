import { WIDGET_TYPES, WidgetLayoutSchema } from '@cube-track/shared';
import { z } from 'zod';

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });

export const DashboardVisibilitySchema = z.enum(['private', 'workspace']);

export const DashboardSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  ownerId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: DashboardVisibilitySchema,
  sourceBoardIds: z.array(z.uuid()),
  filters: z.record(z.string(), z.unknown()).nullable(),
  refreshIntervalSeconds: z.number().int().nullable(),
  position: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  canEdit: z.boolean(),
});

export const CreateDashboardBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
    visibility: DashboardVisibilitySchema.optional(),
    sourceBoardIds: z.array(z.uuid()).max(20).optional(),
    filters: z.record(z.string(), z.unknown()).nullable().optional(),
    refreshIntervalSeconds: z.number().int().min(30).max(86_400).nullable().optional(),
  })
  .strict();

export const UpdateDashboardBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    visibility: DashboardVisibilitySchema.optional(),
    sourceBoardIds: z.array(z.uuid()).max(20).optional(),
    filters: z.record(z.string(), z.unknown()).nullable().optional(),
    refreshIntervalSeconds: z.number().int().min(30).max(86_400).nullable().optional(),
  })
  .strict();

export const WidgetSchema = z.object({
  id: z.uuid(),
  dashboardId: z.uuid(),
  type: z.enum(WIDGET_TYPES),
  title: z.string(),
  config: z.record(z.string(), z.unknown()),
  layout: WidgetLayoutSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateWidgetBody = z
  .object({
    type: z.enum(WIDGET_TYPES),
    title: z.string().trim().min(1).max(200),
    config: z.record(z.string(), z.unknown()),
    layout: WidgetLayoutSchema,
  })
  .strict();

export const UpdateWidgetBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    layout: WidgetLayoutSchema.optional(),
  })
  .strict();

// ------------------------------------------------------------------------------- dados ---

export const NumberWidgetDataSchema = z.object({ kind: z.literal('number'), value: z.string().nullable() });

export const ChartCategorySchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  color: z.string().nullable(),
});

export const ChartWidgetDataSchema = z.object({
  kind: z.literal('chart'),
  categories: z.array(ChartCategorySchema),
});

export const BatteryWidgetDataSchema = z.object({
  kind: z.literal('battery'),
  onTime: z.number().int(),
  replanned: z.number().int(),
  late: z.number().int(),
  noDate: z.number().int(),
  total: z.number().int(),
});

export const WorkloadEntrySchema = z.object({
  personId: z.string(),
  personName: z.string(),
  value: z.number(),
});

export const WorkloadWidgetDataSchema = z.object({
  kind: z.literal('workload'),
  people: z.array(WorkloadEntrySchema),
});

export const ProjectHealthDataSchema = z.object({
  kind: z.literal('project_health'),
  latest: z.object({
    id: z.uuid(),
    reportedAt: z.string(),
    overall: z.enum(['green', 'yellow', 'red', 'grey']),
    schedule: z.enum(['green', 'yellow', 'red', 'grey']),
    cost: z.enum(['green', 'yellow', 'red', 'grey']),
    scope: z.enum(['green', 'yellow', 'red', 'grey']),
    quality: z.enum(['green', 'yellow', 'red', 'grey']),
    risk: z.enum(['green', 'yellow', 'red', 'grey']),
    percentComplete: z.string().nullable(),
    spi: z.string().nullable(),
    cpi: z.string().nullable(),
    summary: z.string().nullable(),
  }).nullable(),
  history: z.array(
    z.object({ id: z.uuid(), reportedAt: z.string(), overall: z.enum(['green', 'yellow', 'red', 'grey']) }),
  ),
});

export const WidgetDataSchema = z.union([
  NumberWidgetDataSchema,
  ChartWidgetDataSchema,
  BatteryWidgetDataSchema,
  WorkloadWidgetDataSchema,
  ProjectHealthDataSchema,
]);

export const DashboardDataResponseSchema = z.object({
  data: z.array(z.object({ widgetId: z.uuid(), type: z.enum(WIDGET_TYPES), data: WidgetDataSchema })),
});

// ---------------------------------------------------------------------- saúde do projeto ---

const healthStatusEnum = z.enum(['green', 'yellow', 'red', 'grey']);

export const ProjectHealthEntrySchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  reportedBy: z.uuid().nullable(),
  reportedAt: z.string(),
  overall: healthStatusEnum,
  schedule: healthStatusEnum,
  cost: healthStatusEnum,
  scope: healthStatusEnum,
  quality: healthStatusEnum,
  risk: healthStatusEnum,
  percentComplete: z.string().nullable(),
  spi: z.string().nullable(),
  cpi: z.string().nullable(),
  summary: z.string().nullable(),
  isAutomatic: z.boolean(),
  overrideReason: z.string().nullable(),
  plannedValue: z.string().nullable(),
  earnedValue: z.string().nullable(),
  actualCost: z.string().nullable(),
  eac: z.string().nullable(),
  vac: z.string().nullable(),
});

export const ReportProjectHealthBody = z
  .object({
    overall: healthStatusEnum,
    schedule: healthStatusEnum.optional(),
    cost: healthStatusEnum.optional(),
    scope: healthStatusEnum.optional(),
    quality: healthStatusEnum.optional(),
    risk: healthStatusEnum.optional(),
    percentComplete: z.number().min(0).max(100).optional(),
    spi: z.number().min(0).max(99).optional(),
    cpi: z.number().min(0).max(99).optional(),
    summary: z.string().trim().min(1).max(4_000).optional(),
    /** Obrigatória (checado no serviço) quando o último relato do board é automático (ADR 0053). */
    overrideReason: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
