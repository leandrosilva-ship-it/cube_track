import { schema, type DatabaseHandle } from '@cube-track/db';
import {
  computeEvm,
  defaultHealthRules,
  evaluateHealthRules,
  plannedValueLinear,
  DomainEventJobSchema,
  type HealthMetrics,
  type HealthRule,
} from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { runAsSystem, type SystemUnit } from '../system-tx.js';

const { boards, budgets, costEntries, healthRuleSets, items, projectHealth, risks } = schema;

/** Mesmo limiar de "risco crítico" usado no widget `risk_heatmap`/`portfolio_rollup` (ADR 0053). */
const CRITICAL_RISK_SCORE = 15;

export interface PortfolioDeps {
  database: DatabaseHandle;
  redis: Redis;
  logger: Logger;
}

export interface RecomputeOutcome {
  boardId: string;
  status: 'applied' | 'skipped';
}

/** Regras de saúde efetivas de um board: próprias → padrão do tenant → `defaultHealthRules()`. */
async function rulesFor(unit: SystemUnit, boardId: string): Promise<HealthRule[]> {
  const [own] = await unit.tx
    .select({ rules: healthRuleSets.rules })
    .from(healthRuleSets)
    .where(and(eq(healthRuleSets.boardId, boardId), isNull(healthRuleSets.deletedAt)));
  if (own !== undefined) return own.rules;
  const [tenantDefault] = await unit.tx
    .select({ rules: healthRuleSets.rules })
    .from(healthRuleSets)
    .where(and(isNull(healthRuleSets.boardId), isNull(healthRuleSets.deletedAt)));
  return tenantDefault?.rules ?? defaultHealthRules();
}

/**
 * Recalcula a saúde (RAG automático + EVM) de um board e grava uma nova linha em `project_health`
 * (`isAutomatic: true`) — cada recálculo é um ponto novo na série histórica (ADR 0053). Dispara
 * `project_health_alert` (via evento `project_health.changed`, consumido por `notifications.ts`)
 * quando o `overall` piora para `yellow`/`red` em relação ao último relato.
 */
export async function recomputeBoardHealth(
  unit: SystemUnit,
  tenantId: string,
  boardId: string,
): Promise<'applied' | 'skipped'> {
  const [board] = await unit.tx
    .select({ id: boards.id, startDate: boards.startDate, endDate: boards.endDate })
    .from(boards)
    .where(eq(boards.id, boardId));
  if (board === undefined) return 'skipped';

  const rules = await rulesFor(unit, boardId);

  const boardBudgets = await unit.tx
    .select({ id: budgets.id, plannedAmount: budgets.plannedAmount })
    .from(budgets)
    .where(and(eq(budgets.boardId, boardId), isNull(budgets.deletedAt)));
  const budgetAtCompletion = boardBudgets.reduce((sum, row) => sum + Number(row.plannedAmount), 0);
  const budgetIds = boardBudgets.map((row) => row.id);
  const actualCost =
    budgetIds.length === 0
      ? 0
      : (
          await unit.tx
            .select({ amount: costEntries.amount })
            .from(costEntries)
            .where(
              and(
                inArray(costEntries.budgetId, budgetIds),
                eq(costEntries.kind, 'actual'),
                isNull(costEntries.deletedAt),
              ),
            )
        ).reduce((sum, row) => sum + Number(row.amount), 0);

  const topLevelItems = await unit.tx
    .select({
      progress: items.progress,
      plannedEndDate: items.plannedEndDate,
      replannedEndDate: items.replannedEndDate,
      actualEndDate: items.actualEndDate,
    })
    .from(items)
    .where(
      and(
        eq(items.boardId, boardId),
        isNull(items.parentItemId),
        isNull(items.deletedAt),
        isNull(items.archivedAt),
      ),
    );
  const percentComplete =
    topLevelItems.length === 0
      ? 0
      : topLevelItems.reduce((sum, item) => sum + (item.progress === null ? 0 : Number(item.progress)), 0) /
        topLevelItems.length;

  const today = new Date().toISOString().slice(0, 10);
  // Mesma classificação de "atrasado" do widget Battery (computeBattery): sem data planejada não
  // conta; com data real, atrasado se veio depois da planejada; replanejado não conta como atraso;
  // senão, atrasado se a data planejada já passou.
  const overdueCount = topLevelItems.filter((item) => {
    if (item.plannedEndDate === null) return false;
    if (item.actualEndDate !== null) return item.actualEndDate > item.plannedEndDate;
    if (item.replannedEndDate !== null && item.replannedEndDate !== item.plannedEndDate) return false;
    return item.plannedEndDate < today;
  }).length;
  const overdueItemsPct = topLevelItems.length === 0 ? 0 : (overdueCount / topLevelItems.length) * 100;

  const openRisks = await unit.tx
    .select({ probability: risks.probability, impact: risks.impact })
    .from(risks)
    .where(
      and(eq(risks.boardId, boardId), isNull(risks.deletedAt), inArray(risks.status, ['open', 'mitigating'])),
    );
  const openCriticalRisks = openRisks.filter((risk) => risk.probability * risk.impact >= CRITICAL_RISK_SCORE).length;

  const budgetVariancePct =
    budgetAtCompletion > 0 ? ((actualCost - budgetAtCompletion) / budgetAtCompletion) * 100 : undefined;

  const plannedValue = plannedValueLinear({
    budgetAtCompletion,
    periodStart: board.startDate,
    periodEnd: board.endDate,
    asOf: today,
  });
  const evm = computeEvm({ budgetAtCompletion, percentComplete, actualCost, plannedValue });

  const metrics: HealthMetrics = {
    ...(evm.spi === null ? {} : { spi: evm.spi }),
    ...(evm.cpi === null ? {} : { cpi: evm.cpi }),
    overdueItemsPct,
    openCriticalRisks,
    ...(budgetVariancePct === undefined ? {} : { budgetVariancePct }),
  };
  const evaluated = evaluateHealthRules(rules, metrics);

  const [row] = await unit.tx
    .insert(projectHealth)
    .values({
      tenantId,
      boardId,
      reportedBy: null,
      overall: evaluated.overall,
      schedule: evaluated.schedule,
      cost: evaluated.cost,
      scope: evaluated.scope,
      quality: evaluated.quality,
      risk: evaluated.risk,
      percentComplete: percentComplete.toFixed(2),
      spi: evm.spi === null ? null : evm.spi.toFixed(3),
      cpi: evm.cpi === null ? null : evm.cpi.toFixed(3),
      isAutomatic: true,
      plannedValue: evm.pv.toFixed(2),
      earnedValue: evm.ev.toFixed(2),
      actualCost: evm.ac.toFixed(2),
      eac: evm.eac.toFixed(2),
      vac: evm.vac.toFixed(2),
    })
    .returning();
  if (row === undefined) return 'skipped';

  await unit.audit({
    action: 'project_health.recomputed',
    entityType: 'project_health',
    entityId: row.id,
    after: { overall: row.overall, isAutomatic: true },
  });
  await unit.emit({
    type: 'project_health.changed',
    aggregateType: 'project_health',
    aggregateId: row.id,
    boardId,
    payload: { healthId: row.id, boardId, overall: row.overall, isAutomatic: true },
  });
  return 'applied';
}

/** Processa `QUEUES.portfolio`: eventos de item/risco/orçamento/lançamento de custo disparam o recálculo do board afetado. */
export function portfolioProcessor(deps: PortfolioDeps) {
  return async (job: Job) => {
    const event = DomainEventJobSchema.parse(job.data);
    const boardId = event.boardId;
    if (boardId === null) return { status: 'skipped' };
    const status = await runAsSystem(
      deps.database,
      deps.redis,
      event.tenantId,
      { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
      (unit) => recomputeBoardHealth(unit, event.tenantId, boardId),
    );
    return { status };
  };
}

/** Rotina diária (`portfolio-health-daily`, ADR 0053): recalcula todo board `project` ativo, mesmo sem mudança recente. */
export function createPortfolioHealthDaily(deps: PortfolioDeps) {
  return async function recomputePortfolioHealth(): Promise<{ outcomes: RecomputeOutcome[] }> {
    const result = await deps.database.db.execute<{ tenant_id: string; board_id: string }>(
      sql`select * from app.portfolio_health_candidates()`,
    );
    const outcomes: RecomputeOutcome[] = [];
    for (const row of result.rows) {
      const status = await runAsSystem(
        deps.database,
        deps.redis,
        row.tenant_id,
        {
          kind: 'system',
          causationId: null,
          depth: 0,
          correlationId: `portfolio-health-daily:${row.board_id}`,
        },
        (unit) => recomputeBoardHealth(unit, row.tenant_id, row.board_id),
      );
      outcomes.push({ boardId: row.board_id, status });
    }
    deps.logger.info({ boards: outcomes.length }, 'Recálculo diário de saúde/RAG concluído');
    return { outcomes };
  };
}
