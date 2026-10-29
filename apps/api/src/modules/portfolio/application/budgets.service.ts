import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { budgets, costEntries, programs, portfolios } = schema;

type BudgetRow = typeof budgets.$inferSelect;
type CostEntryRow = typeof costEntries.$inferSelect;

export interface BudgetDto {
  id: string;
  boardId: string | null;
  programId: string | null;
  portfolioId: string | null;
  name: string;
  category: BudgetRow['category'];
  currency: string;
  plannedAmount: string;
  fiscalYear: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface BudgetInput {
  name: string;
  category?: BudgetRow['category'] | undefined;
  currency?: string | undefined;
  plannedAmount: string;
  fiscalYear?: number | null | undefined;
  periodStart?: string | null | undefined;
  periodEnd?: string | null | undefined;
}

export interface UpdateBudgetInput {
  name?: string | undefined;
  category?: BudgetRow['category'] | undefined;
  currency?: string | undefined;
  plannedAmount?: string | undefined;
  fiscalYear?: number | null | undefined;
  periodStart?: string | null | undefined;
  periodEnd?: string | null | undefined;
}

export interface CostEntryDto {
  id: string;
  budgetId: string;
  boardId: string | null;
  itemId: string | null;
  entryDate: string;
  amount: string;
  currency: string;
  kind: CostEntryRow['kind'];
  source: CostEntryRow['source'];
  category: string | null;
  description: string | null;
  reference: string | null;
}

export interface CostEntryInput {
  entryDate: string;
  amount: string;
  currency?: string | undefined;
  kind?: CostEntryRow['kind'] | undefined;
  itemId?: string | null | undefined;
  category?: string | null | undefined;
  description?: string | null | undefined;
  reference?: string | null | undefined;
}

export interface UpdateCostEntryInput {
  entryDate?: string | undefined;
  amount?: string | undefined;
  currency?: string | undefined;
  kind?: CostEntryRow['kind'] | undefined;
  category?: string | null | undefined;
  description?: string | null | undefined;
  reference?: string | null | undefined;
}

function toBudgetDto(row: BudgetRow): BudgetDto {
  return {
    id: row.id,
    boardId: row.boardId,
    programId: row.programId,
    portfolioId: row.portfolioId,
    name: row.name,
    category: row.category,
    currency: row.currency,
    plannedAmount: row.plannedAmount,
    fiscalYear: row.fiscalYear,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

function toCostEntryDto(row: CostEntryRow): CostEntryDto {
  return {
    id: row.id,
    budgetId: row.budgetId,
    boardId: row.boardId,
    itemId: row.itemId,
    entryDate: row.entryDate,
    amount: row.amount,
    currency: row.currency,
    kind: row.kind,
    source: row.source,
    category: row.category,
    description: row.description,
    reference: row.reference,
  };
}

/**
 * Orçamentos e lançamentos de custo (ADR 0053): um orçamento pertence a exatamente um board,
 * programa ou portfólio (check `budgets_single_owner`). Permissão de board usa `board.manage`;
 * de programa/portfólio, `portfolio.manage` no workspace dono.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForBoard(user: AuthPrincipal, boardId: string): Promise<BudgetDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.boardId, boardId), isNull(budgets.deletedAt)));
    return rows.map(toBudgetDto);
  }

  async createForBoard(user: AuthPrincipal, boardId: string, input: BudgetInput): Promise<BudgetDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    return this.insert(user, { boardId, programId: null, portfolioId: null }, input);
  }

  async createForProgram(user: AuthPrincipal, programId: string, input: BudgetInput): Promise<BudgetDto> {
    const [program] = await this.runner.tx.select({ workspaceId: programs.workspaceId }).from(programs).where(eq(programs.id, programId));
    if (program === undefined) throw new NotFoundError('Programa');
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: program.workspaceId }, 'Workspace');
    return this.insert(user, { boardId: null, programId, portfolioId: null }, input);
  }

  async createForPortfolio(user: AuthPrincipal, portfolioId: string, input: BudgetInput): Promise<BudgetDto> {
    const [portfolio] = await this.runner.tx
      .select({ workspaceId: portfolios.workspaceId })
      .from(portfolios)
      .where(eq(portfolios.id, portfolioId));
    if (portfolio === undefined) throw new NotFoundError('Portfólio');
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: portfolio.workspaceId }, 'Workspace');
    return this.insert(user, { boardId: null, programId: null, portfolioId }, input);
  }

  private async insert(
    user: AuthPrincipal,
    owner: { boardId: string | null; programId: string | null; portfolioId: string | null },
    input: BudgetInput,
  ): Promise<BudgetDto> {
    if (!(Number(input.plannedAmount) >= 0))
      throw new ValidationError([{ path: 'body.plannedAmount', message: 'Deve ser maior ou igual a zero.' }]);
    const [row] = await this.runner.tx
      .insert(budgets)
      .values({
        tenantId: user.tenantId,
        ...owner,
        name: input.name,
        category: input.category ?? 'opex',
        currency: input.currency ?? 'BRL',
        plannedAmount: input.plannedAmount,
        fiscalYear: input.fiscalYear ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar orçamento.');
    await this.emitBudgetChanged(user, row, 'created');
    return toBudgetDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateBudgetInput): Promise<BudgetDto> {
    const existing = await this.lockedBudget(id);
    await this.assertBudgetManage(user, existing);
    const [row] = await this.runner.tx
      .update(budgets)
      .set({
        name: input.name ?? existing.name,
        category: input.category ?? existing.category,
        currency: input.currency ?? existing.currency,
        plannedAmount: input.plannedAmount ?? existing.plannedAmount,
        fiscalYear: input.fiscalYear === undefined ? existing.fiscalYear : input.fiscalYear,
        periodStart: input.periodStart === undefined ? existing.periodStart : input.periodStart,
        periodEnd: input.periodEnd === undefined ? existing.periodEnd : input.periodEnd,
      })
      .where(eq(budgets.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar orçamento.');
    await this.emitBudgetChanged(user, row, 'updated');
    return toBudgetDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.lockedBudget(id);
    await this.assertBudgetManage(user, existing);
    await this.runner.tx.update(budgets).set({ deletedAt: new Date() }).where(eq(budgets.id, id));
    await this.emitBudgetChanged(user, existing, 'deleted');
  }

  // ---------------------------------------------------------------------------- cost entries ---

  async listCostEntries(user: AuthPrincipal, budgetId: string): Promise<CostEntryDto[]> {
    const budget = await this.lockedBudget(budgetId);
    await this.assertBudgetRead(user, budget);
    const rows = await this.runner.tx
      .select()
      .from(costEntries)
      .where(and(eq(costEntries.budgetId, budgetId), isNull(costEntries.deletedAt)));
    return rows.map(toCostEntryDto);
  }

  async createCostEntry(user: AuthPrincipal, budgetId: string, input: CostEntryInput): Promise<CostEntryDto> {
    const budget = await this.lockedBudget(budgetId);
    await this.assertBudgetManage(user, budget);
    if (!(Number(input.amount) >= 0)) throw new ValidationError([{ path: 'body.amount', message: 'Deve ser maior ou igual a zero.' }]);
    const [row] = await this.runner.tx
      .insert(costEntries)
      .values({
        tenantId: user.tenantId,
        budgetId,
        boardId: budget.boardId,
        itemId: input.itemId ?? null,
        entryDate: input.entryDate,
        amount: input.amount,
        currency: input.currency ?? budget.currency,
        kind: input.kind ?? 'actual',
        source: 'manual',
        category: input.category ?? null,
        description: input.description ?? null,
        reference: input.reference ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao lançar custo.');
    await this.emitCostEntryChanged(user, row, 'created');
    return toCostEntryDto(row);
  }

  async updateCostEntry(user: AuthPrincipal, id: string, input: UpdateCostEntryInput): Promise<CostEntryDto> {
    const [existing] = await this.runner.tx.select().from(costEntries).where(eq(costEntries.id, id));
    if (existing === undefined) throw new NotFoundError('Lançamento de custo');
    const budget = await this.lockedBudget(existing.budgetId);
    await this.assertBudgetManage(user, budget);
    const [row] = await this.runner.tx
      .update(costEntries)
      .set({
        entryDate: input.entryDate ?? existing.entryDate,
        amount: input.amount ?? existing.amount,
        currency: input.currency ?? existing.currency,
        kind: input.kind ?? existing.kind,
        category: input.category === undefined ? existing.category : input.category,
        description: input.description === undefined ? existing.description : input.description,
        reference: input.reference === undefined ? existing.reference : input.reference,
      })
      .where(eq(costEntries.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar lançamento de custo.');
    await this.emitCostEntryChanged(user, row, 'updated');
    return toCostEntryDto(row);
  }

  async removeCostEntry(user: AuthPrincipal, id: string): Promise<void> {
    const [existing] = await this.runner.tx.select().from(costEntries).where(eq(costEntries.id, id));
    if (existing === undefined) throw new NotFoundError('Lançamento de custo');
    const budget = await this.lockedBudget(existing.budgetId);
    await this.assertBudgetManage(user, budget);
    await this.runner.tx.update(costEntries).set({ deletedAt: new Date() }).where(eq(costEntries.id, id));
    await this.emitCostEntryChanged(user, existing, 'deleted');
  }

  private async lockedBudget(id: string): Promise<BudgetRow> {
    const [row] = await this.runner.tx.select().from(budgets).where(eq(budgets.id, id));
    if (row === undefined) throw new NotFoundError('Orçamento');
    return row;
  }

  private async assertBudgetManage(user: AuthPrincipal, budget: BudgetRow): Promise<void> {
    if (budget.boardId !== null) {
      await this.access.assert(user, 'board.manage', { type: 'board', id: budget.boardId }, 'Board');
      return;
    }
    const workspaceId = await this.ownerWorkspaceId(budget);
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
  }

  private async assertBudgetRead(user: AuthPrincipal, budget: BudgetRow): Promise<void> {
    if (budget.boardId !== null) {
      await this.access.assert(user, 'board.read', { type: 'board', id: budget.boardId }, 'Board');
      return;
    }
    const workspaceId = await this.ownerWorkspaceId(budget);
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: workspaceId }, 'Workspace');
  }

  private async ownerWorkspaceId(budget: BudgetRow): Promise<string> {
    if (budget.programId !== null) {
      const [program] = await this.runner.tx.select({ workspaceId: programs.workspaceId }).from(programs).where(eq(programs.id, budget.programId));
      if (program === undefined) throw new NotFoundError('Programa');
      return program.workspaceId;
    }
    if (budget.portfolioId !== null) {
      const [portfolio] = await this.runner.tx
        .select({ workspaceId: portfolios.workspaceId })
        .from(portfolios)
        .where(eq(portfolios.id, budget.portfolioId));
      if (portfolio === undefined) throw new NotFoundError('Portfólio');
      return portfolio.workspaceId;
    }
    throw new Error('Orçamento sem dono válido.');
  }

  private async emitBudgetChanged(
    user: AuthPrincipal,
    row: Pick<BudgetRow, 'id' | 'boardId' | 'programId' | 'portfolioId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'budget.changed',
      aggregateType: 'budget',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { budgetId: row.id, boardId: row.boardId, programId: row.programId, portfolioId: row.portfolioId, change },
      actorId: user.userId,
    });
  }

  private async emitCostEntryChanged(
    user: AuthPrincipal,
    row: Pick<CostEntryRow, 'id' | 'budgetId' | 'boardId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'cost_entry.changed',
      aggregateType: 'cost_entry',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { costEntryId: row.id, budgetId: row.budgetId, boardId: row.boardId, change },
      actorId: user.userId,
    });
  }
}

export type { BudgetRow, CostEntryRow };
