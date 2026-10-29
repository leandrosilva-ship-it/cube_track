/**
 * Motores de gestão de portfólio (ADR 0053): regras de saúde (RAG automático), Earned Value (EVM),
 * rollup Projeto → Programa → Portfólio, pontuação ponderada/WSJF e simulação what-if. Puro e
 * síncrono — sem I/O; a API busca os dados e passa aqui para calcular.
 */
import { z } from 'zod';

import { HEALTH_STATUSES, type HealthStatus } from './project-health.js';

// ---------------------------------------------------------------------------
// Regras de saúde (RAG automático)
// ---------------------------------------------------------------------------

export const HEALTH_RULE_DIMENSIONS = [
  'overall',
  'schedule',
  'cost',
  'scope',
  'quality',
  'risk',
] as const;
export type HealthRuleDimension = (typeof HEALTH_RULE_DIMENSIONS)[number];

/** Métricas disponíveis para regras — cada uma é opcional no cálculo (regra sem dado é ignorada). */
export const HEALTH_RULE_METRICS = [
  'spi',
  'cpi',
  'overdue_items_pct',
  'open_critical_risks',
  'budget_variance_pct',
] as const;
export type HealthRuleMetric = (typeof HEALTH_RULE_METRICS)[number];

export const HEALTH_RULE_OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq'] as const;
export type HealthRuleOperator = (typeof HEALTH_RULE_OPERATORS)[number];

export const HealthRuleSchema = z
  .object({
    dimension: z.enum(HEALTH_RULE_DIMENSIONS),
    metric: z.enum(HEALTH_RULE_METRICS),
    operator: z.enum(HEALTH_RULE_OPERATORS),
    threshold: z.number(),
    result: z.enum(HEALTH_STATUSES),
  })
  .strict();
export type HealthRule = z.infer<typeof HealthRuleSchema>;

export const HealthRuleSetSchema = z.array(HealthRuleSchema).max(50);

export interface HealthMetrics {
  spi?: number;
  cpi?: number;
  overdueItemsPct?: number;
  openCriticalRisks?: number;
  budgetVariancePct?: number;
}

const METRIC_FIELD: Record<HealthRuleMetric, keyof HealthMetrics> = {
  spi: 'spi',
  cpi: 'cpi',
  overdue_items_pct: 'overdueItemsPct',
  open_critical_risks: 'openCriticalRisks',
  budget_variance_pct: 'budgetVariancePct',
};

function compare(value: number, operator: HealthRuleOperator, threshold: number): boolean {
  if (operator === 'lt') return value < threshold;
  if (operator === 'lte') return value <= threshold;
  if (operator === 'gt') return value > threshold;
  if (operator === 'gte') return value >= threshold;
  return value === threshold;
}

const HEALTH_RANK: Record<HealthStatus, number> = { grey: 0, green: 1, yellow: 2, red: 3 };

/** Pior status entre os informados (`red` > `yellow` > `green` > `grey`); lista vazia → `grey`. */
export function worstHealth(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>(
    (worst, status) => (HEALTH_RANK[status] > HEALTH_RANK[worst] ? status : worst),
    'grey',
  );
}

/**
 * Avalia as regras, na ordem do array: para cada dimensão, a primeira regra cuja métrica está
 * disponível e cujo operador casa decide a cor; sem regra casando, `grey` (sem dado suficiente).
 * `overall`, quando nenhuma regra própria casa, é o pior-caso das demais dimensões (rollup simples).
 */
export function evaluateHealthRules(
  rules: readonly HealthRule[],
  metrics: HealthMetrics,
): Record<HealthRuleDimension, HealthStatus> {
  const result = Object.fromEntries(
    HEALTH_RULE_DIMENSIONS.map((dimension) => [dimension, 'grey']),
  ) as Record<HealthRuleDimension, HealthStatus>;

  for (const dimension of HEALTH_RULE_DIMENSIONS) {
    for (const rule of rules) {
      if (rule.dimension !== dimension) continue;
      const value = metrics[METRIC_FIELD[rule.metric]];
      if (value === undefined) continue;
      if (compare(value, rule.operator, rule.threshold)) {
        result[dimension] = rule.result;
        break;
      }
    }
  }
  if (result.overall === 'grey') {
    result.overall = worstHealth([
      result.schedule,
      result.cost,
      result.scope,
      result.quality,
      result.risk,
    ]);
  }
  return result;
}

/** Regras padrão sugeridas (board/tenant sem configuração própria) — espelha o critério de aceite do Prompt 12. */
export function defaultHealthRules(): HealthRule[] {
  return [
    { dimension: 'schedule', metric: 'spi', operator: 'lt', threshold: 0.8, result: 'red' },
    { dimension: 'schedule', metric: 'spi', operator: 'lt', threshold: 0.9, result: 'yellow' },
    { dimension: 'schedule', metric: 'spi', operator: 'gte', threshold: 0.9, result: 'green' },
    { dimension: 'cost', metric: 'cpi', operator: 'lt', threshold: 0.8, result: 'red' },
    { dimension: 'cost', metric: 'cpi', operator: 'lt', threshold: 0.9, result: 'yellow' },
    { dimension: 'cost', metric: 'cpi', operator: 'gte', threshold: 0.9, result: 'green' },
    { dimension: 'risk', metric: 'open_critical_risks', operator: 'gte', threshold: 1, result: 'red' },
    { dimension: 'risk', metric: 'open_critical_risks', operator: 'lt', threshold: 1, result: 'green' },
  ];
}

// ---------------------------------------------------------------------------
// Earned Value (EVM)
// ---------------------------------------------------------------------------

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Valor planejado (PV) por distribuição linear do orçamento total ao longo do período — aproximação
 * padrão quando não há um baseline time-phased detalhado (ADR 0053). `asOf` antes do início ou sem
 * período definido devolve `0`; depois do fim devolve o total (BAC).
 */
export function plannedValueLinear(options: {
  budgetAtCompletion: number;
  periodStart: string | null;
  periodEnd: string | null;
  asOf: string;
}): number {
  const { budgetAtCompletion, periodStart, periodEnd, asOf } = options;
  if (periodStart === null || periodEnd === null || periodEnd <= periodStart) return budgetAtCompletion;
  if (asOf <= periodStart) return 0;
  if (asOf >= periodEnd) return budgetAtCompletion;
  const total = daysBetween(periodStart, periodEnd);
  const elapsed = daysBetween(periodStart, asOf);
  return budgetAtCompletion * (elapsed / total);
}

export interface EvmInput {
  /** BAC — soma dos orçamentos planejados do projeto/programa/portfólio. */
  budgetAtCompletion: number;
  /** 0–100. */
  percentComplete: number;
  /** AC — soma dos lançamentos de custo `kind: 'actual'`. */
  actualCost: number;
  /** PV já calculado (ex.: `plannedValueLinear`). */
  plannedValue: number;
}

export interface EvmResult {
  pv: number;
  ev: number;
  ac: number;
  /** `null` quando `pv` é `0` (sem base de comparação ainda). */
  spi: number | null;
  /** `null` quando `ac` é `0` (nenhum custo lançado ainda). */
  cpi: number | null;
  eac: number;
  vac: number;
}

/**
 * SPI = EV/PV, CPI = EV/AC. EAC usa a fórmula padrão `AC + (BAC-EV)/CPI` (assume que o desempenho de
 * custo observado se mantém até o fim); sem CPI disponível, cai para `AC + (BAC-EV)` (sem projeção).
 */
export function computeEvm(input: EvmInput): EvmResult {
  const { budgetAtCompletion: bac, percentComplete, actualCost: ac, plannedValue: pv } = input;
  const ev = bac * (percentComplete / 100);
  const spi = pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;
  const remaining = bac - ev;
  const eac = cpi !== null && cpi > 0 ? ac + remaining / cpi : ac + remaining;
  const vac = bac - eac;
  return { pv, ev, ac, spi, cpi, eac, vac };
}

// ---------------------------------------------------------------------------
// Rollup Projeto → Programa → Portfólio
// ---------------------------------------------------------------------------

export interface BoardRollupInput {
  boardId: string;
  startDate: string | null;
  endDate: string | null;
  /** 0–100; `null` quando o board ainda não tem saúde relatada. */
  percentComplete: number | null;
  overall: HealthStatus;
  plannedCost: number;
  actualCost: number;
  /** EAC quando disponível; caso contrário, igual a `actualCost` (sem projeção). */
  forecastCost: number;
  ustTotal: number;
  openRisks: number;
  criticalRisks: number;
}

export interface RollupResult {
  boardCount: number;
  startDate: string | null;
  endDate: string | null;
  /** Média ponderada pelo orçamento planejado de cada projeto; média simples se nenhum tiver orçamento. */
  percentComplete: number;
  plannedCost: number;
  actualCost: number;
  forecastCost: number;
  ustTotal: number;
  openRisks: number;
  criticalRisks: number;
  /** Pior status entre os projetos agregados — um portfólio nunca é mais saudável que seu pior projeto. */
  overall: HealthStatus;
}

/** Agrega projetos (boards) de um programa ou portfólio — soma custos/UST/riscos, pior-caso de RAG. */
export function aggregateRollup(boards: readonly BoardRollupInput[]): RollupResult {
  if (boards.length === 0) {
    return {
      boardCount: 0,
      startDate: null,
      endDate: null,
      percentComplete: 0,
      plannedCost: 0,
      actualCost: 0,
      forecastCost: 0,
      ustTotal: 0,
      openRisks: 0,
      criticalRisks: 0,
      overall: 'grey',
    };
  }
  const startDates = boards.map((b) => b.startDate).filter((d): d is string => d !== null);
  const endDates = boards.map((b) => b.endDate).filter((d): d is string => d !== null);
  const totalPlanned = boards.reduce((sum, b) => sum + b.plannedCost, 0);
  const weightedPercent = boards.reduce(
    (sum, b) => sum + (b.percentComplete ?? 0) * (b.plannedCost > 0 ? b.plannedCost : 1),
    0,
  );
  const weightBase = totalPlanned > 0 ? totalPlanned : boards.length;
  return {
    boardCount: boards.length,
    startDate: startDates.length > 0 ? startDates.reduce((min, d) => (d < min ? d : min)) : null,
    endDate: endDates.length > 0 ? endDates.reduce((max, d) => (d > max ? d : max)) : null,
    percentComplete: weightBase > 0 ? weightedPercent / weightBase : 0,
    plannedCost: totalPlanned,
    actualCost: boards.reduce((sum, b) => sum + b.actualCost, 0),
    forecastCost: boards.reduce((sum, b) => sum + b.forecastCost, 0),
    ustTotal: boards.reduce((sum, b) => sum + b.ustTotal, 0),
    openRisks: boards.reduce((sum, b) => sum + b.openRisks, 0),
    criticalRisks: boards.reduce((sum, b) => sum + b.criticalRisks, 0),
    overall: worstHealth(boards.map((b) => b.overall)),
  };
}

// ---------------------------------------------------------------------------
// Pontuação ponderada e WSJF
// ---------------------------------------------------------------------------

export interface ScoringCriterionInput {
  key: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  higherIsBetter: boolean;
}

/**
 * Pontuação ponderada normalizada em 0–100: cada critério é normalizado para [0,1] conforme sua
 * escala e sentido (`higherIsBetter`), multiplicado pelo peso e somado; pesos não precisam somar 1
 * (a soma é normalizada pelo total de pesos efetivamente usados). Critério sem valor em `scores` é
 * ignorado (não entra no denominador).
 */
export function computeWeightedScore(
  criteria: readonly ScoringCriterionInput[],
  scores: Readonly<Record<string, number>>,
): number {
  let weightedTotal = 0;
  let weightSum = 0;
  for (const criterion of criteria) {
    const raw = scores[criterion.key];
    if (raw === undefined) continue;
    const range = criterion.scaleMax - criterion.scaleMin || 1;
    const normalized = criterion.higherIsBetter
      ? (raw - criterion.scaleMin) / range
      : (criterion.scaleMax - raw) / range;
    weightedTotal += normalized * criterion.weight;
    weightSum += criterion.weight;
  }
  if (weightSum <= 0) return 0;
  return (weightedTotal / weightSum) * 100;
}

/**
 * Chaves fixas por convenção quando `scoringModels.method === 'wsjf'` (ADR 0053): o mesmo mapa
 * `criteriaScores` genérico guarda estes 4 valores em vez de critérios livres.
 */
export const WSJF_KEYS = {
  businessValue: 'business_value',
  timeCriticality: 'time_criticality',
  riskReduction: 'risk_reduction',
  jobSize: 'job_size',
} as const;

export interface WsjfInput {
  businessValue: number;
  timeCriticality: number;
  riskReduction: number;
  jobSize: number;
}

/** WSJF = (valor de negócio + criticidade de tempo + redução de risco) / tamanho do trabalho. */
export function computeWsjf(input: WsjfInput): number {
  if (input.jobSize <= 0) return 0;
  return (input.businessValue + input.timeCriticality + input.riskReduction) / input.jobSize;
}

/** Lê os 4 valores de `WSJF_KEYS` de um mapa `criteriaScores` genérico; `undefined` se faltar algum. */
export function wsjfInputFromScores(scores: Readonly<Record<string, number>>): WsjfInput | undefined {
  const businessValue = scores[WSJF_KEYS.businessValue];
  const timeCriticality = scores[WSJF_KEYS.timeCriticality];
  const riskReduction = scores[WSJF_KEYS.riskReduction];
  const jobSize = scores[WSJF_KEYS.jobSize];
  if (
    businessValue === undefined ||
    timeCriticality === undefined ||
    riskReduction === undefined ||
    jobSize === undefined
  ) {
    return undefined;
  }
  return { businessValue, timeCriticality, riskReduction, jobSize };
}

export const EFFORT_VALUE_QUADRANTS = [
  'quick_win',
  'major_project',
  'fill_in',
  'thankless_task',
] as const;
export type EffortValueQuadrant = (typeof EFFORT_VALUE_QUADRANTS)[number];

/** Classifica um ponto na matriz valor × esforço pela mediana da amostra (alto/baixo relativo). */
export function classifyEffortValue(
  point: { value: number; effort: number },
  medianValue: number,
  medianEffort: number,
): EffortValueQuadrant {
  const highValue = point.value >= medianValue;
  const highEffort = point.effort >= medianEffort;
  if (highValue && !highEffort) return 'quick_win';
  if (highValue && highEffort) return 'major_project';
  if (!highValue && !highEffort) return 'fill_in';
  return 'thankless_task';
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid] ?? 0;
  const lowerMidValue = sorted[mid - 1] ?? midValue;
  return sorted.length % 2 === 0 ? (lowerMidValue + midValue) / 2 : midValue;
}

// ---------------------------------------------------------------------------
// Simulação what-if (incluir/excluir/adiar projetos)
// ---------------------------------------------------------------------------

export const WHAT_IF_ACTIONS = ['include', 'exclude', 'delay'] as const;
export type WhatIfAction = (typeof WHAT_IF_ACTIONS)[number];

export interface WhatIfProject {
  boardId: string;
  active: boolean;
  plannedCost: number;
  startDate: string | null;
  endDate: string | null;
}

export interface WhatIfChange {
  boardId: string;
  action: WhatIfAction;
  /** Só para `action: 'delay'` — dias a somar em `startDate`/`endDate`. */
  delayDays?: number;
}

export interface WhatIfSummary {
  activeProjects: number;
  totalPlannedCost: number;
  latestEndDate: string | null;
}

function shiftIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const result = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return result.toISOString().slice(0, 10);
}

/** Aplica inclusões/exclusões/adiamentos a uma lista-base de projetos, devolvendo o cenário resultante. */
export function applyWhatIfChanges(
  baseline: readonly WhatIfProject[],
  changes: readonly WhatIfChange[],
): WhatIfProject[] {
  const changeByBoard = new Map(changes.map((change) => [change.boardId, change]));
  return baseline.map((project) => {
    const change = changeByBoard.get(project.boardId);
    if (change === undefined) return project;
    if (change.action === 'include') return { ...project, active: true };
    if (change.action === 'exclude') return { ...project, active: false };
    const days = change.delayDays ?? 0;
    return {
      ...project,
      startDate: project.startDate === null ? null : shiftIso(project.startDate, days),
      endDate: project.endDate === null ? null : shiftIso(project.endDate, days),
    };
  });
}

/** Resume um cenário (só projetos `active`): custo total planejado e a data de término mais distante. */
export function summarizeWhatIf(projects: readonly WhatIfProject[]): WhatIfSummary {
  const active = projects.filter((project) => project.active);
  const endDates = active.map((p) => p.endDate).filter((d): d is string => d !== null);
  return {
    activeProjects: active.length,
    totalPlannedCost: active.reduce((sum, p) => sum + p.plannedCost, 0),
    latestEndDate: endDates.length > 0 ? endDates.reduce((max, d) => (d > max ? d : max)) : null,
  };
}
