import { z } from 'zod';

import { ROLLUP_AGGREGATES } from './columns/registry.js';
import { FILTER_OPERATORS, FilterScalarSchema } from './query.js';

/**
 * Registro de tipos de widget de dashboard (ADR 0050). Cada tipo define o schema Zod de `config`
 * (`widgets.config`, JSONB) — a mesma convenção do registro de colunas (`columns/registry.ts`).
 * Os valores aqui batem exatamente com os widgets já semeados em `packages/db/src/seed/workspace.ts`
 * (dashboard "Project Health – PMSP").
 */

export const WIDGET_TYPES = [
  'number',
  'chart_bar',
  'chart_pie',
  'battery',
  'workload',
  'project_health',
  'capacity',
  'portfolio_rollup',
  'risk_heatmap',
  'budget_variance',
  'ust_balance',
  'ust_by_dimension',
  'ust_forecast',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export function isWidgetType(value: string): value is WidgetType {
  return (WIDGET_TYPES as readonly string[]).includes(value);
}

/** Agregações numéricas disponíveis para widgets `number`/`chart_bar` (mesmo catálogo de rollup). */
export const WIDGET_AGGREGATES = ROLLUP_AGGREGATES;
export type WidgetAggregate = (typeof WIDGET_AGGREGATES)[number];

const boardIds = z.array(z.uuid()).min(1).max(20);
const columnKey = z.string().min(1).max(64);

/** Filtro simples de widget: um grupo de itens, ou uma única condição sobre uma coluna. */
export const WidgetGroupFilterSchema = z.object({ groupIds: z.array(z.uuid()).min(1).max(100) }).strict();
export const WidgetConditionFilterSchema = z
  .object({
    columnKey,
    operator: z.enum(FILTER_OPERATORS),
    value: z.union([FilterScalarSchema, z.array(FilterScalarSchema).max(200), z.null()]).optional(),
  })
  .strict();
export const WidgetFilterSchema = z.union([WidgetGroupFilterSchema, WidgetConditionFilterSchema]);
export type WidgetFilter = z.infer<typeof WidgetFilterSchema>;

export function isGroupFilter(filter: WidgetFilter): filter is z.infer<typeof WidgetGroupFilterSchema> {
  return 'groupIds' in filter;
}

/** KPI numérico: soma/média/contagem... de uma coluna (ou contagem de itens) sobre um filtro opcional. */
export const NumberWidgetConfigSchema = z
  .object({
    boardIds,
    columnKey: columnKey.optional(),
    aggregate: z.enum(WIDGET_AGGREGATES),
    filter: WidgetFilterSchema.optional(),
  })
  .strict();
export type NumberWidgetConfig = z.infer<typeof NumberWidgetConfigSchema>;

/** Gráfico de barras: valor de `yColumnKey` (ou contagem) agregado por categoria de `xColumnKey`. */
export const ChartBarWidgetConfigSchema = z
  .object({
    boardIds,
    xColumnKey: columnKey,
    yColumnKey: columnKey.optional(),
    aggregate: z.enum(WIDGET_AGGREGATES),
    filter: WidgetFilterSchema.optional(),
  })
  .strict();
export type ChartBarWidgetConfig = z.infer<typeof ChartBarWidgetConfigSchema>;

/** Gráfico de pizza: contagem de itens por valor distinto de `columnKey` (status, dropdown...). */
export const ChartPieWidgetConfigSchema = z
  .object({ boardIds, columnKey, filter: WidgetFilterSchema.optional() })
  .strict();
export type ChartPieWidgetConfig = z.infer<typeof ChartPieWidgetConfigSchema>;

/** "Bateria" de prazos: no prazo × replanejado × atrasado, comparando datas planejado/replanejado/realizado. */
export const BatteryWidgetConfigSchema = z
  .object({
    boardIds,
    plannedColumnKey: columnKey,
    replannedColumnKey: columnKey.optional(),
    actualColumnKey: columnKey.optional(),
    filter: WidgetFilterSchema.optional(),
  })
  .strict();
export type BatteryWidgetConfig = z.infer<typeof BatteryWidgetConfigSchema>;

/** Carga de trabalho: contagem de itens (ou soma de uma coluna numérica) por pessoa de `peopleColumnKey`. */
export const WorkloadWidgetConfigSchema = z
  .object({
    boardIds,
    peopleColumnKey: columnKey,
    valueColumnKey: columnKey.optional(),
    aggregate: z.enum(WIDGET_AGGREGATES).optional(),
    filter: WidgetFilterSchema.optional(),
  })
  .strict();
export type WorkloadWidgetConfig = z.infer<typeof WorkloadWidgetConfigSchema>;

/** Saúde do projeto: último relato (e histórico curto) de `project_health` para um board. */
export const ProjectHealthWidgetConfigSchema = z.object({ boardId: z.uuid() }).strict();
export type ProjectHealthWidgetConfig = z.infer<typeof ProjectHealthWidgetConfigSchema>;

/**
 * Capacidade (ADR 0052): disponível × alocado por pessoa, time ou skill — diferente do widget
 * `workload` (que conta itens por valor de uma coluna `people`), este lê `resource_profiles`/
 * `allocations`/`absences` diretamente, sem depender de nenhum board específico.
 */
export const CapacityWidgetConfigSchema = z
  .object({
    groupBy: z.enum(['person', 'team', 'skill']).default('person'),
    userIds: z.array(z.uuid()).max(100).optional(),
    teamIds: z.array(z.uuid()).max(50).optional(),
    skillId: z.uuid().optional(),
    granularity: z.enum(['day', 'week', 'month']).default('week'),
  })
  .strict();
export type CapacityWidgetConfig = z.infer<typeof CapacityWidgetConfigSchema>;

/**
 * Rollup de portfólio/programa (ADR 0053): cartões agregados (prazo, custo, UST, % concluído, RAG
 * pior-caso) de um portfólio ou programa específico — motor `aggregateRollup` de `portfolio.ts`.
 */
export const PortfolioRollupWidgetConfigSchema = z
  .object({ scope: z.enum(['portfolio', 'program']), id: z.uuid() })
  .strict();
export type PortfolioRollupWidgetConfig = z.infer<typeof PortfolioRollupWidgetConfigSchema>;

/** Matriz de riscos (probabilidade × impacto) dos riscos abertos de um ou mais boards. */
export const RiskHeatmapWidgetConfigSchema = z.object({ boardIds }).strict();
export type RiskHeatmapWidgetConfig = z.infer<typeof RiskHeatmapWidgetConfigSchema>;

/** Planejado × realizado × previsto (EAC) dos orçamentos de um ou mais boards. */
export const BudgetVarianceWidgetConfigSchema = z.object({ boardIds }).strict();
export type BudgetVarianceWidgetConfig = z.infer<typeof BudgetVarianceWidgetConfigSchema>;

/** Saldo de UST de um contrato (ADR 0054): contratado × consumido × restante, motor `contracts.ts`. */
export const UstBalanceWidgetConfigSchema = z.object({ contractId: z.uuid() }).strict();
export type UstBalanceWidgetConfig = z.infer<typeof UstBalanceWidgetConfigSchema>;

/**
 * UST consumida por mês, ou por um valor de coluna (ex.: órgão/frente) dos itens com OS do
 * contrato — `columnKey`/`boardId` só fazem sentido (e são exigidos) quando `dimension: 'column'`.
 */
export const UstByDimensionWidgetConfigSchema = z
  .object({
    contractId: z.uuid(),
    dimension: z.enum(['month', 'column']),
    boardId: z.uuid().optional(),
    columnKey: z.string().min(1).max(64).optional(),
  })
  .strict()
  .refine((config) => config.dimension !== 'column' || (config.boardId !== undefined && config.columnKey !== undefined), {
    message: "boardId e columnKey são obrigatórios quando dimension é 'column'.",
  });
export type UstByDimensionWidgetConfig = z.infer<typeof UstByDimensionWidgetConfigSchema>;

/** Previsão de esgotamento do saldo (ADR 0054) — motor `forecastExhaustion` de `contracts.ts`. */
export const UstForecastWidgetConfigSchema = z.object({ contractId: z.uuid() }).strict();
export type UstForecastWidgetConfig = z.infer<typeof UstForecastWidgetConfigSchema>;

export const WIDGET_CONFIG_SCHEMAS = {
  number: NumberWidgetConfigSchema,
  chart_bar: ChartBarWidgetConfigSchema,
  chart_pie: ChartPieWidgetConfigSchema,
  battery: BatteryWidgetConfigSchema,
  workload: WorkloadWidgetConfigSchema,
  project_health: ProjectHealthWidgetConfigSchema,
  capacity: CapacityWidgetConfigSchema,
  portfolio_rollup: PortfolioRollupWidgetConfigSchema,
  risk_heatmap: RiskHeatmapWidgetConfigSchema,
  budget_variance: BudgetVarianceWidgetConfigSchema,
  ust_balance: UstBalanceWidgetConfigSchema,
  ust_by_dimension: UstByDimensionWidgetConfigSchema,
  ust_forecast: UstForecastWidgetConfigSchema,
} as const satisfies Record<WidgetType, z.ZodType>;

export type WidgetConfig = {
  [K in WidgetType]: z.infer<(typeof WIDGET_CONFIG_SCHEMAS)[K]>;
}[WidgetType];

/** Valida `config` conforme `type`; lança `ZodError` se inválido (chamador decide como mapear o erro). */
export function parseWidgetConfig<T extends WidgetType>(
  type: T,
  raw: unknown,
): z.infer<(typeof WIDGET_CONFIG_SCHEMAS)[T]> {
  return WIDGET_CONFIG_SCHEMAS[type].parse(raw) as z.infer<(typeof WIDGET_CONFIG_SCHEMAS)[T]>;
}

/** Layout do widget na grade do dashboard (unidades de coluna/linha, não pixels). */
export const WidgetLayoutSchema = z
  .object({
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(999),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(20),
  })
  .strict();
export type WidgetLayout = z.infer<typeof WidgetLayoutSchema>;

export const DASHBOARD_GRID_COLUMNS = 12;
