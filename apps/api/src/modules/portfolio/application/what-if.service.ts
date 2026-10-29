import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { applyWhatIfChanges, summarizeWhatIf, type WhatIfChange, type WhatIfProject, type WhatIfSummary } from '@cube-track/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';

const { portfolios, programs, boards, budgets } = schema;

export interface WhatIfOutput {
  baseline: WhatIfSummary;
  simulated: WhatIfSummary;
}

/**
 * Simulação what-if (ADR 0053): incluir/excluir/adiar projetos de um portfólio/programa e comparar
 * o cenário resultante com a linha de base — nunca grava nada (puro cálculo sobre dados atuais).
 */
@Injectable()
export class WhatIfService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
  ) {}

  async simulate(
    user: AuthPrincipal,
    scope: 'portfolio' | 'program',
    id: string,
    changes: readonly WhatIfChange[],
  ): Promise<WhatIfOutput> {
    const baseline = await this.baselineFor(user, scope, id);
    const simulated = applyWhatIfChanges(baseline, changes);
    return { baseline: summarizeWhatIf(baseline), simulated: summarizeWhatIf(simulated) };
  }

  private async baselineFor(user: AuthPrincipal, scope: 'portfolio' | 'program', id: string): Promise<WhatIfProject[]> {
    let boardIds: string[];
    if (scope === 'portfolio') {
      const [portfolio] = await this.runner.tx.select().from(portfolios).where(eq(portfolios.id, id));
      if (portfolio === undefined) throw new NotFoundError('Portfólio');
      await this.access.assert(user, 'portfolio.read', { type: 'workspace', id: portfolio.workspaceId }, 'Workspace');
      const programRows = await this.runner.tx
        .select({ id: programs.id })
        .from(programs)
        .where(and(eq(programs.portfolioId, id), isNull(programs.deletedAt)));
      const programIds = programRows.map((row) => row.id);
      const rows = await this.runner.tx
        .select({ id: boards.id, startDate: boards.startDate, endDate: boards.endDate })
        .from(boards)
        .where(
          and(
            isNull(boards.deletedAt),
            programIds.length > 0 ? or(eq(boards.portfolioId, id), inArray(boards.programId, programIds)) : eq(boards.portfolioId, id),
          ),
        );
      boardIds = rows.map((row) => row.id);
      return this.projectsOf(boardIds);
    }
    const [program] = await this.runner.tx.select().from(programs).where(eq(programs.id, id));
    if (program === undefined) throw new NotFoundError('Programa');
    await this.access.assert(user, 'portfolio.read', { type: 'workspace', id: program.workspaceId }, 'Workspace');
    const rows = await this.runner.tx
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.programId, id), isNull(boards.deletedAt)));
    boardIds = rows.map((row) => row.id);
    return this.projectsOf(boardIds);
  }

  private async projectsOf(boardIds: readonly string[]): Promise<WhatIfProject[]> {
    if (boardIds.length === 0) return [];
    const boardMeta = await this.runner.tx
      .select({ id: boards.id, startDate: boards.startDate, endDate: boards.endDate })
      .from(boards)
      .where(inArray(boards.id, boardIds));
    const budgetRows = await this.runner.tx
      .select({ boardId: budgets.boardId, plannedAmount: budgets.plannedAmount })
      .from(budgets)
      .where(and(inArray(budgets.boardId, boardIds), isNull(budgets.deletedAt)));
    return boardMeta.map((board) => ({
      boardId: board.id,
      active: true,
      plannedCost: budgetRows
        .filter((row) => row.boardId === board.id)
        .reduce((sum, row) => sum + Number(row.plannedAmount), 0),
      startDate: board.startDate,
      endDate: board.endDate,
    }));
  }
}
