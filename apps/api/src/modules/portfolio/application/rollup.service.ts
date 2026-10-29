import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { aggregateRollup, type BoardRollupInput, type RollupResult } from '@cube-track/shared';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';

const { portfolios, programs, boards, budgets, costEntries, risks, projectHealth } = schema;

/** Risco "crítico" (ADR 0053): score probabilidade × impacto (1–25) >= 15 — mesma convenção de `widget-data.service.ts`. */
const CRITICAL_RISK_SCORE = 15;

export interface RollupOutput {
  name: string;
  rollup: RollupResult;
}

/**
 * Rollup Projeto → Programa → Portfólio (ADR 0053): agrega os boards de um programa ou portfólio
 * (diretos + via programas, no caso de portfólio) com `aggregateRollup` de `packages/shared`.
 */
@Injectable()
export class RollupService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
  ) {}

  async forPortfolio(user: AuthPrincipal, portfolioId: string): Promise<RollupOutput> {
    const [portfolio] = await this.runner.tx.select().from(portfolios).where(eq(portfolios.id, portfolioId));
    if (portfolio === undefined) throw new NotFoundError('Portfólio');
    await this.access.assert(user, 'portfolio.read', { type: 'workspace', id: portfolio.workspaceId }, 'Workspace');
    const programRows = await this.runner.tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.portfolioId, portfolioId), isNull(programs.deletedAt)));
    const programIds = programRows.map((row) => row.id);
    const boardRows = await this.runner.tx
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          isNull(boards.deletedAt),
          programIds.length > 0
            ? or(eq(boards.portfolioId, portfolioId), inArray(boards.programId, programIds))
            : eq(boards.portfolioId, portfolioId),
        ),
      );
    return { name: portfolio.name, rollup: await this.aggregate(boardRows.map((row) => row.id)) };
  }

  async forProgram(user: AuthPrincipal, programId: string): Promise<RollupOutput> {
    const [program] = await this.runner.tx.select().from(programs).where(eq(programs.id, programId));
    if (program === undefined) throw new NotFoundError('Programa');
    await this.access.assert(user, 'portfolio.read', { type: 'workspace', id: program.workspaceId }, 'Workspace');
    const boardRows = await this.runner.tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.programId, programId), isNull(boards.deletedAt)));
    return { name: program.name, rollup: await this.aggregate(boardRows.map((row) => row.id)) };
  }

  private async aggregate(boardIds: readonly string[]): Promise<RollupResult> {
    if (boardIds.length === 0) return aggregateRollup([]);
    const boardMeta = await this.runner.tx
      .select({ id: boards.id, startDate: boards.startDate, endDate: boards.endDate })
      .from(boards)
      .where(inArray(boards.id, boardIds));
    const budgetRows = await this.runner.tx
      .select({ id: budgets.id, boardId: budgets.boardId, plannedAmount: budgets.plannedAmount })
      .from(budgets)
      .where(and(inArray(budgets.boardId, boardIds), isNull(budgets.deletedAt)));
    const budgetIds = budgetRows.map((row) => row.id);
    const costRows =
      budgetIds.length === 0
        ? []
        : await this.runner.tx
            .select({ budgetId: costEntries.budgetId, kind: costEntries.kind, amount: costEntries.amount })
            .from(costEntries)
            .where(and(inArray(costEntries.budgetId, budgetIds), isNull(costEntries.deletedAt)));
    const riskRows = await this.runner.tx
      .select({ boardId: risks.boardId, probability: risks.probability, impact: risks.impact })
      .from(risks)
      .where(and(inArray(risks.boardId, boardIds), isNull(risks.deletedAt), inArray(risks.status, ['open', 'mitigating'])));
    const healthRows = await this.runner.tx
      .select({
        boardId: projectHealth.boardId,
        overall: projectHealth.overall,
        percentComplete: projectHealth.percentComplete,
        eac: projectHealth.eac,
      })
      .from(projectHealth)
      .where(inArray(projectHealth.boardId, boardIds))
      .orderBy(desc(projectHealth.reportedAt));
    const latestHealthByBoard = new Map<string, (typeof healthRows)[number]>();
    for (const row of healthRows) if (!latestHealthByBoard.has(row.boardId)) latestHealthByBoard.set(row.boardId, row);

    const inputs: BoardRollupInput[] = boardMeta.map((board) => {
      const boardBudgets = budgetRows.filter((row) => row.boardId === board.id);
      const plannedCost = boardBudgets.reduce((sum, row) => sum + Number(row.plannedAmount), 0);
      const budgetIdsOfBoard = new Set(boardBudgets.map((row) => row.id));
      const actualCost = costRows
        .filter((row) => budgetIdsOfBoard.has(row.budgetId) && row.kind === 'actual')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const health = latestHealthByBoard.get(board.id);
      const forecastCost = health?.eac !== undefined && health.eac !== null ? Number(health.eac) : actualCost;
      const boardRisks = riskRows.filter((row) => row.boardId === board.id);
      return {
        boardId: board.id,
        startDate: board.startDate,
        endDate: board.endDate,
        percentComplete:
          health?.percentComplete !== undefined && health.percentComplete !== null ? Number(health.percentComplete) : null,
        overall: health?.overall ?? 'grey',
        plannedCost,
        actualCost,
        forecastCost,
        ustTotal: 0,
        openRisks: boardRisks.length,
        criticalRisks: boardRisks.filter((row) => row.probability * row.impact >= CRITICAL_RISK_SCORE).length,
      };
    });
    return aggregateRollup(inputs);
  }
}
