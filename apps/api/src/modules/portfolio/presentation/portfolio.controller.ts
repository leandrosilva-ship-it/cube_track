import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { PortfoliosService } from '../application/portfolios.service.js';
import { ProgramsService } from '../application/programs.service.js';
import { RollupService } from '../application/rollup.service.js';
import { ScoringService } from '../application/scoring.service.js';
import { WhatIfService } from '../application/what-if.service.js';
import * as S from './schemas.js';

/** Portfólios, programas, priorização (scoring/WSJF/ranking/matriz valor×esforço), rollup e what-if (ADR 0053). */
@Controller()
export class PortfolioController {
  constructor(
    private readonly portfolios: PortfoliosService,
    private readonly programs: ProgramsService,
    private readonly scoring: ScoringService,
    private readonly rollup: RollupService,
    private readonly whatIf: WhatIfService,
  ) {}

  // ----------------------------------------------------------------------------- portfólios ---

  @Get('workspaces/:workspaceId/portfolios')
  @Endpoint({
    summary: 'Listar portfólios do workspace',
    tags: ['portfolio'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.PortfolioSchema) }),
  })
  async listPortfolios(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.WorkspaceParams>) {
    return { data: await this.portfolios.list(user, params.workspaceId) };
  }

  @Post('workspaces/:workspaceId/portfolios')
  @Audited({ action: 'portfolio.create', entityType: 'portfolio' })
  @Endpoint({
    summary: 'Criar portfólio',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreatePortfolioBody,
    response: S.PortfolioSchema,
  })
  createPortfolio(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreatePortfolioBody>,
  ) {
    return this.portfolios.create(user, params.workspaceId, body);
  }

  @Get('portfolios/:id')
  @Endpoint({ summary: 'Obter um portfólio', tags: ['portfolio'], params: S.IdParams, response: S.PortfolioSchema })
  getPortfolio(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.portfolios.get(user, params.id);
  }

  @Patch('portfolios/:id')
  @Audited({ action: 'portfolio.update', entityType: 'portfolio' })
  @Endpoint({
    summary: 'Atualizar portfólio',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdatePortfolioBody,
    response: S.PortfolioSchema,
  })
  updatePortfolio(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdatePortfolioBody>,
  ) {
    return this.portfolios.update(user, params.id, body);
  }

  @Delete('portfolios/:id')
  @Audited({ action: 'portfolio.delete', entityType: 'portfolio' })
  @Endpoint({ summary: 'Excluir portfólio', description: 'Requer `portfolio.manage`.', tags: ['portfolio'], params: S.IdParams })
  removePortfolio(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.portfolios.remove(user, params.id);
  }

  @Get('portfolios/:id/rollup')
  @Endpoint({
    summary: 'Rollup agregado do portfólio (projetos diretos e via programas)',
    tags: ['portfolio'],
    params: S.IdParams,
    response: S.RollupResponseSchema,
  })
  async portfolioRollup(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return (await this.rollup.forPortfolio(user, params.id)).rollup;
  }

  // ------------------------------------------------------------------------------- programas ---

  @Get('workspaces/:workspaceId/programs')
  @Endpoint({
    summary: 'Listar programas do workspace',
    tags: ['portfolio'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.ProgramSchema) }),
  })
  async listPrograms(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.WorkspaceParams>) {
    return { data: await this.programs.list(user, params.workspaceId) };
  }

  @Post('workspaces/:workspaceId/programs')
  @Audited({ action: 'program.create', entityType: 'program' })
  @Endpoint({
    summary: 'Criar programa',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateProgramBody,
    response: S.ProgramSchema,
  })
  createProgram(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateProgramBody>,
  ) {
    return this.programs.create(user, params.workspaceId, body);
  }

  @Get('programs/:id')
  @Endpoint({ summary: 'Obter um programa', tags: ['portfolio'], params: S.IdParams, response: S.ProgramSchema })
  getProgram(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.programs.get(user, params.id);
  }

  @Patch('programs/:id')
  @Audited({ action: 'program.update', entityType: 'program' })
  @Endpoint({
    summary: 'Atualizar programa',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateProgramBody,
    response: S.ProgramSchema,
  })
  updateProgram(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateProgramBody>,
  ) {
    return this.programs.update(user, params.id, body);
  }

  @Delete('programs/:id')
  @Audited({ action: 'program.delete', entityType: 'program' })
  @Endpoint({ summary: 'Excluir programa', description: 'Requer `portfolio.manage`.', tags: ['portfolio'], params: S.IdParams })
  removeProgram(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.programs.remove(user, params.id);
  }

  @Get('programs/:id/rollup')
  @Endpoint({
    summary: 'Rollup agregado do programa',
    tags: ['portfolio'],
    params: S.IdParams,
    response: S.RollupResponseSchema,
  })
  async programRollup(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return (await this.rollup.forProgram(user, params.id)).rollup;
  }

  // ------------------------------------------------------------------------------- scoring ---

  @Get('scoring-models')
  @Endpoint({
    summary: 'Listar modelos de pontuação (ponderada/WSJF) do tenant',
    description: 'Requer `portfolio.read` no workspace principal.',
    tags: ['portfolio'],
    response: z.object({ data: z.array(S.ScoringModelSchema) }),
  })
  async listScoringModels(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.scoring.listModels(user) };
  }

  @Post('scoring-models')
  @Audited({ action: 'scoring_model.create', entityType: 'scoring_model' })
  @Endpoint({
    summary: 'Criar modelo de pontuação',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    status: 201,
    body: S.CreateScoringModelBody,
    response: S.ScoringModelSchema,
  })
  createScoringModel(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.CreateScoringModelBody>) {
    return this.scoring.createModel(user, body);
  }

  @Patch('scoring-models/:id')
  @Audited({ action: 'scoring_model.update', entityType: 'scoring_model' })
  @Endpoint({
    summary: 'Atualizar modelo de pontuação',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateScoringModelBody,
    response: S.ScoringModelSchema,
  })
  updateScoringModel(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateScoringModelBody>,
  ) {
    return this.scoring.updateModel(user, params.id, body);
  }

  @Post('boards/:boardId/score')
  @Audited({ action: 'score.set', entityType: 'score' })
  @Endpoint({
    summary: 'Pontuar um projeto (ponderada ou WSJF, conforme o modelo)',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.BoardParams,
    body: S.SetScoreBody,
    response: S.ScoreSchema,
  })
  setScore(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.SetScoreBody>,
  ) {
    return this.scoring.setScore(user, params.boardId, body);
  }

  @Get('scoring-models/:id/ranking')
  @Endpoint({
    summary: 'Ranking de projetos pontuados por um modelo (ordem decrescente)',
    tags: ['portfolio'],
    params: S.IdParams,
    response: z.object({ data: z.array(S.RankingEntrySchema) }),
  })
  async ranking(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return { data: await this.scoring.ranking(user, params.id) };
  }

  @Get('scoring-models/:id/value-effort')
  @Endpoint({
    summary: 'Matriz valor × esforço (1º e 2º critérios do modelo), classificada por quadrante',
    tags: ['portfolio'],
    params: S.IdParams,
    response: z.object({ data: z.array(S.ValueEffortPointSchema) }),
  })
  async valueEffort(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return { data: await this.scoring.valueEffortMatrix(user, params.id) };
  }

  // ------------------------------------------------------------------------------- what-if ---

  @Post('portfolio/what-if')
  @Endpoint({
    summary: 'Simular incluir/excluir/adiar projetos de um portfólio ou programa (não grava nada)',
    tags: ['portfolio'],
    body: S.WhatIfBody,
    response: S.WhatIfResponseSchema,
  })
  simulate(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.WhatIfBody>) {
    return this.whatIf.simulate(user, body.scope, body.id, body.changes);
  }
}
