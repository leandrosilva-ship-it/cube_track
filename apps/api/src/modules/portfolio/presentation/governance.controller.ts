import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IssuesService } from '../application/issues.service.js';
import { RisksService } from '../application/risks.service.js';
import { StageGatesService } from '../application/stage-gates.service.js';
import * as S from './schemas.js';

/** Stage gates, riscos e problemas (issues) de um projeto (ADR 0053). */
@Controller()
export class GovernanceController {
  constructor(
    private readonly stageGates: StageGatesService,
    private readonly risks: RisksService,
    private readonly issues: IssuesService,
  ) {}

  // ----------------------------------------------------------------------------- stage gates ---

  @Get('boards/:boardId/stage-gates')
  @Endpoint({
    summary: 'Listar portões de decisão do projeto, em ordem',
    tags: ['portfolio'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.StageGateSchema) }),
  })
  async listStageGates(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return { data: await this.stageGates.list(user, params.boardId) };
  }

  @Post('boards/:boardId/stage-gates')
  @Audited({ action: 'stage_gate.create', entityType: 'stage_gate' })
  @Endpoint({
    summary: 'Criar portão de decisão',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateStageGateBody,
    response: S.StageGateSchema,
  })
  createStageGate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateStageGateBody>,
  ) {
    return this.stageGates.create(user, params.boardId, body);
  }

  @Patch('stage-gates/:id')
  @Audited({ action: 'stage_gate.update', entityType: 'stage_gate' })
  @Endpoint({
    summary: 'Atualizar portão (nome, prazo, checklist, notas)',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateStageGateBody,
    response: S.StageGateSchema,
  })
  updateStageGate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateStageGateBody>,
  ) {
    return this.stageGates.update(user, params.id, body);
  }

  @Post('stage-gates/:id/decide')
  @Audited({ action: 'stage_gate.decide', entityType: 'stage_gate' })
  @Endpoint({
    summary: 'Aprovar, rejeitar ou pular um portão',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.DecideStageGateBody,
    response: S.StageGateSchema,
  })
  decideStageGate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.DecideStageGateBody>,
  ) {
    return this.stageGates.decide(user, params.id, body);
  }

  @Post('boards/:boardId/stage-gates/reorder')
  @Audited({ action: 'stage_gate.reorder', entityType: 'stage_gate' })
  @Endpoint({
    summary: 'Reordenar os portões do projeto',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    params: S.BoardParams,
    body: S.ReorderStageGatesBody,
  })
  reorderStageGates(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.ReorderStageGatesBody>,
  ) {
    return this.stageGates.reorder(user, params.boardId, body.orderedIds);
  }

  @Delete('stage-gates/:id')
  @Audited({ action: 'stage_gate.delete', entityType: 'stage_gate' })
  @Endpoint({ summary: 'Excluir portão', description: 'Requer `board.manage`.', tags: ['portfolio'], params: S.IdParams })
  removeStageGate(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.stageGates.remove(user, params.id);
  }

  // --------------------------------------------------------------------------------- riscos ---

  @Get('boards/:boardId/risks')
  @Endpoint({
    summary: 'Listar riscos do projeto',
    tags: ['portfolio'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.RiskSchema) }),
  })
  async listRisks(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return { data: await this.risks.list(user, params.boardId) };
  }

  @Post('boards/:boardId/risks')
  @Audited({ action: 'risk.create', entityType: 'risk' })
  @Endpoint({
    summary: 'Registrar risco (probabilidade × impacto, 1-5)',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateRiskBody,
    response: S.RiskSchema,
  })
  createRisk(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateRiskBody>,
  ) {
    return this.risks.create(user, params.boardId, body);
  }

  @Patch('risks/:id')
  @Audited({ action: 'risk.update', entityType: 'risk' })
  @Endpoint({
    summary: 'Atualizar risco (inclui mudar status, ex.: fechar)',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateRiskBody,
    response: S.RiskSchema,
  })
  updateRisk(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateRiskBody>,
  ) {
    return this.risks.update(user, params.id, body);
  }

  @Delete('risks/:id')
  @Audited({ action: 'risk.delete', entityType: 'risk' })
  @Endpoint({ summary: 'Excluir risco', description: 'Requer `board.manage`.', tags: ['portfolio'], params: S.IdParams })
  removeRisk(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.risks.remove(user, params.id);
  }

  // ------------------------------------------------------------------------------ problemas ---

  @Get('boards/:boardId/issues')
  @Endpoint({
    summary: 'Listar problemas (issues) do projeto',
    tags: ['portfolio'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.IssueSchema) }),
  })
  async listIssues(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return { data: await this.issues.list(user, params.boardId) };
  }

  @Post('boards/:boardId/issues')
  @Audited({ action: 'issue.create', entityType: 'issue' })
  @Endpoint({
    summary: 'Registrar problema, opcionalmente originado de um risco',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateIssueBody,
    response: S.IssueSchema,
  })
  createIssue(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateIssueBody>,
  ) {
    return this.issues.create(user, params.boardId, body);
  }

  @Patch('issues/:id')
  @Audited({ action: 'issue.update', entityType: 'issue' })
  @Endpoint({
    summary: 'Atualizar problema (inclui resolver)',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    params: S.IdParams,
    body: S.UpdateIssueBody,
    response: S.IssueSchema,
  })
  updateIssue(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateIssueBody>,
  ) {
    return this.issues.update(user, params.id, body);
  }

  @Delete('issues/:id')
  @Audited({ action: 'issue.delete', entityType: 'issue' })
  @Endpoint({ summary: 'Excluir problema', description: 'Requer `board.manage`.', tags: ['portfolio'], params: S.IdParams })
  removeIssue(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return this.issues.remove(user, params.id);
  }
}
