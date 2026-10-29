import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { BudgetsService } from '../application/budgets.service.js';
import * as S from './schemas.js';

/** Orçamentos (planejado × realizado × previsto) e lançamentos de custo de projeto/programa/portfólio (ADR 0053). */
@Controller()
export class BudgetController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get('boards/:boardId/budgets')
  @Endpoint({
    summary: 'Listar orçamentos de um projeto',
    tags: ['portfolio'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.BudgetSchema) }),
  })
  async listForBoard(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return { data: await this.budgets.listForBoard(user, params.boardId) };
  }

  @Post('boards/:boardId/budgets')
  @Audited({ action: 'budget.create', entityType: 'budget' })
  @Endpoint({
    summary: 'Criar orçamento de projeto',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateBudgetBody,
    response: S.BudgetSchema,
  })
  createForBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateBudgetBody>,
  ) {
    return this.budgets.createForBoard(user, params.boardId, body);
  }

  @Post('programs/:programId/budgets')
  @Audited({ action: 'budget.create', entityType: 'budget' })
  @Endpoint({
    summary: 'Criar orçamento de programa',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.ProgramParams,
    body: S.CreateBudgetBody,
    response: S.BudgetSchema,
  })
  createForProgram(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ProgramParams>,
    @Input('body') body: z.infer<typeof S.CreateBudgetBody>,
  ) {
    return this.budgets.createForProgram(user, params.programId, body);
  }

  @Post('portfolios/:portfolioId/budgets')
  @Audited({ action: 'budget.create', entityType: 'budget' })
  @Endpoint({
    summary: 'Criar orçamento de portfólio',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.PortfolioParams,
    body: S.CreateBudgetBody,
    response: S.BudgetSchema,
  })
  createForPortfolio(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.PortfolioParams>,
    @Input('body') body: z.infer<typeof S.CreateBudgetBody>,
  ) {
    return this.budgets.createForPortfolio(user, params.portfolioId, body);
  }

  @Patch('budgets/:id')
  @Audited({ action: 'budget.update', entityType: 'budget' })
  @Endpoint({
    summary: 'Atualizar orçamento',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateBudgetBody,
    response: S.BudgetSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateBudgetBody>,
  ) {
    return this.budgets.update(user, params.id, body);
  }

  @Delete('budgets/:id')
  @Audited({ action: 'budget.delete', entityType: 'budget' })
  @Endpoint({ summary: 'Excluir orçamento', tags: ['portfolio'], params: S.IdParams })
  remove(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.budgets.remove(user, params.id);
  }

  // --------------------------------------------------------------------------- cost entries ---

  @Get('budgets/:id/cost-entries')
  @Endpoint({
    summary: 'Listar lançamentos de custo de um orçamento',
    tags: ['portfolio'],
    params: S.IdParams,
    response: z.object({ data: z.array(S.CostEntrySchema) }),
  })
  async listCostEntries(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return { data: await this.budgets.listCostEntries(user, params.id) };
  }

  @Post('budgets/:id/cost-entries')
  @Audited({ action: 'cost_entry.create', entityType: 'cost_entry' })
  @Endpoint({
    summary: 'Lançar custo (planejado, real ou previsão) contra um orçamento',
    tags: ['portfolio'],
    status: 201,
    params: S.IdParams,
    body: S.CreateCostEntryBody,
    response: S.CostEntrySchema,
  })
  createCostEntry(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.CreateCostEntryBody>,
  ) {
    return this.budgets.createCostEntry(user, params.id, body);
  }

  @Patch('cost-entries/:id')
  @Audited({ action: 'cost_entry.update', entityType: 'cost_entry' })
  @Endpoint({
    summary: 'Atualizar lançamento de custo',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateCostEntryBody,
    response: S.CostEntrySchema,
  })
  updateCostEntry(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateCostEntryBody>,
  ) {
    return this.budgets.updateCostEntry(user, params.id, body);
  }

  @Delete('cost-entries/:id')
  @Audited({ action: 'cost_entry.delete', entityType: 'cost_entry' })
  @Endpoint({ summary: 'Excluir lançamento de custo', tags: ['portfolio'], params: S.IdParams })
  removeCostEntry(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.budgets.removeCostEntry(user, params.id);
  }
}
