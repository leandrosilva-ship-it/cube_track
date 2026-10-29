import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import type { IssueDto } from './issues.service.js';
import type { RiskDto } from './risks.service.js';
import { RollupService, type RollupOutput } from './rollup.service.js';
import type { StageGateDto } from './stage-gates.service.js';

const { boards, budgets, costEntries, issues, projectHealth, risks, stageGates } = schema;

export interface BoardStatusReport {
  boardId: string;
  boardName: string;
  health: { latest: (typeof projectHealth.$inferSelect) | null; history: (typeof projectHealth.$inferSelect)[] };
  percentComplete: number;
  evm: { pv: number; ev: number; ac: number; spi: number | null; cpi: number | null; eac: number; vac: number };
  budget: { plannedAmount: number; actualAmount: number; forecastAmount: number };
  openRisks: RiskDto[];
  openIssues: IssueDto[];
  stageGates: StageGateDto[];
}

/**
 * Status report (ADR 0053): agregação sob demanda, sem tabela própria — monta a partir do histórico
 * de `project_health` (que já serve como a série do "report periódico"), orçamento, riscos/issues
 * abertos e stage gates de um board. Exportação em PDF é responsabilidade do frontend (html2canvas +
 * jspdf, mesmo padrão do Gantt/Dashboard, ADR 0049/0050) — este endpoint só monta os dados.
 */
@Injectable()
export class StatusReportService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly rollup: RollupService,
  ) {}

  async forBoard(user: AuthPrincipal, boardId: string): Promise<BoardStatusReport> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const [board] = await this.runner.tx.select({ name: boards.name }).from(boards).where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');

    const history = await this.runner.tx
      .select()
      .from(projectHealth)
      .where(eq(projectHealth.boardId, boardId))
      .orderBy(desc(projectHealth.reportedAt))
      .limit(20);
    const latest = history[0] ?? null;

    const boardBudgets = await this.runner.tx
      .select({ id: budgets.id, plannedAmount: budgets.plannedAmount })
      .from(budgets)
      .where(and(eq(budgets.boardId, boardId), isNull(budgets.deletedAt)));
    const plannedAmount = boardBudgets.reduce((sum, row) => sum + Number(row.plannedAmount), 0);
    const budgetIds = boardBudgets.map((row) => row.id);
    const actualAmount =
      budgetIds.length === 0
        ? 0
        : (
            await this.runner.tx
              .select({ amount: costEntries.amount })
              .from(costEntries)
              .where(and(inArray(costEntries.budgetId, budgetIds), eq(costEntries.kind, 'actual'), isNull(costEntries.deletedAt)))
          ).reduce((sum, row) => sum + Number(row.amount), 0);

    const openRiskRows = await this.runner.tx
      .select()
      .from(risks)
      .where(and(eq(risks.boardId, boardId), isNull(risks.deletedAt), inArray(risks.status, ['open', 'mitigating'])));
    const openIssueRows = await this.runner.tx
      .select()
      .from(issues)
      .where(and(eq(issues.boardId, boardId), isNull(issues.deletedAt), inArray(issues.status, ['open', 'in_progress'])));
    const gateRows = await this.runner.tx.select().from(stageGates).where(eq(stageGates.boardId, boardId));

    return {
      boardId,
      boardName: board.name,
      health: { latest, history },
      percentComplete: latest?.percentComplete === null || latest?.percentComplete === undefined ? 0 : Number(latest.percentComplete),
      evm: {
        pv: latest?.plannedValue === null || latest?.plannedValue === undefined ? 0 : Number(latest.plannedValue),
        ev: latest?.earnedValue === null || latest?.earnedValue === undefined ? 0 : Number(latest.earnedValue),
        ac: latest?.actualCost === null || latest?.actualCost === undefined ? 0 : Number(latest.actualCost),
        spi: latest?.spi === null || latest?.spi === undefined ? null : Number(latest.spi),
        cpi: latest?.cpi === null || latest?.cpi === undefined ? null : Number(latest.cpi),
        eac: latest?.eac === null || latest?.eac === undefined ? 0 : Number(latest.eac),
        vac: latest?.vac === null || latest?.vac === undefined ? 0 : Number(latest.vac),
      },
      budget: { plannedAmount, actualAmount, forecastAmount: latest?.eac === null || latest?.eac === undefined ? actualAmount : Number(latest.eac) },
      openRisks: openRiskRows.map((row) => ({
        id: row.id,
        boardId: row.boardId,
        itemId: row.itemId,
        title: row.title,
        description: row.description,
        category: row.category,
        probability: row.probability,
        impact: row.impact,
        status: row.status,
        strategy: row.strategy,
        mitigationPlan: row.mitigationPlan,
        contingencyPlan: row.contingencyPlan,
        ownerId: row.ownerId,
        dueDate: row.dueDate,
        closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
      })),
      openIssues: openIssueRows.map((row) => ({
        id: row.id,
        boardId: row.boardId,
        itemId: row.itemId,
        riskId: row.riskId,
        title: row.title,
        description: row.description,
        severity: row.severity,
        status: row.status,
        ownerId: row.ownerId,
        dueDate: row.dueDate,
        resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
        resolution: row.resolution,
      })),
      stageGates: gateRows.map((row) => ({
        id: row.id,
        boardId: row.boardId,
        name: row.name,
        position: row.position,
        status: row.status,
        dueDate: row.dueDate,
        criteria: row.criteria,
        decidedBy: row.decidedBy,
        decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
        notes: row.notes,
      })),
    };
  }

  async forPortfolio(user: AuthPrincipal, portfolioId: string): Promise<RollupOutput> {
    return this.rollup.forPortfolio(user, portfolioId);
  }

  async forProgram(user: AuthPrincipal, programId: string): Promise<RollupOutput> {
    return this.rollup.forProgram(user, programId);
  }
}
