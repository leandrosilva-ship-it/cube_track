import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { ProcessesService } from '../application/processes.service.js';
import { SlasService } from '../application/slas.service.js';
import * as S from './schemas.js';

/** Processos (ADR 0051): pipe, fases, regras de transição e definições de SLA de um board. */
@Controller()
export class ProcessesController {
  constructor(
    private readonly processes: ProcessesService,
    private readonly slas: SlasService,
  ) {}

  // ------------------------------------------------------------------------------- leitura ---

  @Get('boards/:boardId/process')
  @Endpoint({
    summary: 'Configuração de processo do board (pipe, fases, regras de transição e SLAs)',
    description: 'Requer `board.read`. Base da coluna de fase/SLA no Kanban e da tela de config.',
    tags: ['processes'],
    params: S.BoardParams,
    response: S.ProcessConfigSchema,
  })
  config(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return this.processes.config(user, params.boardId);
  }

  @Get('boards/:boardId/slas')
  @Endpoint({
    summary: 'Listar definições de SLA do board',
    description: 'Requer `board.read`.',
    tags: ['processes'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.SlaSchema) }),
  })
  async listSlas(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.slas.list(user, params.boardId) };
  }

  @Get('boards/:boardId/sla-trackers')
  @Endpoint({
    summary: 'Trackers de SLA correntes (em execução ou pausados) do board',
    description: 'Requer `board.read`. Base do indicador de SLA nos cartões do Kanban.',
    tags: ['processes'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.SlaTrackerSchema) }),
  })
  async listSlaTrackers(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.slas.listTrackers(user, params.boardId) };
  }

  // ----------------------------------------------------------------------------------- pipe ---

  @Post('boards/:boardId/pipe')
  @Audited({ action: 'pipe.create', entityType: 'pipe' })
  @Endpoint({
    summary: 'Criar o pipe do board',
    description: 'Requer `process.manage`. O board precisa ser do tipo Processo (`kind: process`).',
    tags: ['processes'],
    status: 201,
    params: S.BoardParams,
    body: S.CreatePipeBody,
    response: S.PipeSchema,
    errors: [409, 422],
  })
  createPipe(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreatePipeBody>,
  ) {
    return this.processes.createPipe(user, params.boardId, body);
  }

  @Patch('pipes/:id')
  @Audited({ action: 'pipe.update', entityType: 'pipe' })
  @Endpoint({
    summary: 'Atualizar o pipe',
    tags: ['processes'],
    params: IdParams,
    body: S.UpdatePipeBody,
    response: S.PipeSchema,
  })
  updatePipe(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdatePipeBody>,
  ) {
    return this.processes.updatePipe(user, params.id, body);
  }

  @Delete('pipes/:id')
  @Audited({ action: 'pipe.delete', entityType: 'pipe' })
  @Endpoint({
    summary: 'Excluir o pipe (e suas fases e regras de transição)',
    tags: ['processes'],
    params: IdParams,
    status: 204,
  })
  async removePipe(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.processes.removePipe(user, params.id);
  }

  // ---------------------------------------------------------------------------------- fases ---

  @Post('pipes/:pipeId/phases')
  @Audited({ action: 'phase.create', entityType: 'phase' })
  @Endpoint({
    summary: 'Criar fase (cria também o grupo correspondente no board)',
    description: 'Requer `process.manage`.',
    tags: ['processes'],
    status: 201,
    params: S.PipeParams,
    body: S.CreatePhaseBody,
    response: S.PhaseSchema,
  })
  createPhase(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.PipeParams>,
    @Input('body') body: z.infer<typeof S.CreatePhaseBody>,
  ) {
    return this.processes.createPhase(user, params.pipeId, body);
  }

  @Patch('phases/:id')
  @Audited({ action: 'phase.update', entityType: 'phase' })
  @Endpoint({
    summary: 'Atualizar fase',
    tags: ['processes'],
    params: IdParams,
    body: S.UpdatePhaseBody,
    response: S.PhaseSchema,
  })
  updatePhase(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdatePhaseBody>,
  ) {
    return this.processes.updatePhase(user, params.id, body);
  }

  @Delete('phases/:id')
  @Audited({ action: 'phase.delete', entityType: 'phase' })
  @Endpoint({
    summary: 'Excluir fase (o grupo do board permanece, sem vínculo de fase)',
    tags: ['processes'],
    params: IdParams,
    status: 204,
  })
  async removePhase(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.processes.removePhase(user, params.id);
  }

  // ------------------------------------------------------------------------ regras de transição ---

  @Post('pipes/:pipeId/transitions')
  @Audited({ action: 'phase_transition_rule.create', entityType: 'phase_transition_rule' })
  @Endpoint({
    summary: 'Criar regra de transição entre fases',
    description:
      'Requer `process.manage`. `fromPhaseId` nulo = regra válida a partir de qualquer fase.',
    tags: ['processes'],
    status: 201,
    params: S.PipeParams,
    body: S.TransitionRuleBody,
    response: S.TransitionRuleSchema,
    errors: [422],
  })
  createTransitionRule(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.PipeParams>,
    @Input('body') body: z.infer<typeof S.TransitionRuleBody>,
  ) {
    return this.processes.createTransitionRule(user, params.pipeId, body);
  }

  @Patch('transitions/:id')
  @Audited({ action: 'phase_transition_rule.update', entityType: 'phase_transition_rule' })
  @Endpoint({
    summary: 'Atualizar regra de transição',
    tags: ['processes'],
    params: IdParams,
    body: S.UpdateTransitionRuleBody,
    response: S.TransitionRuleSchema,
    errors: [422],
  })
  updateTransitionRule(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateTransitionRuleBody>,
  ) {
    return this.processes.updateTransitionRule(user, params.id, body);
  }

  @Delete('transitions/:id')
  @Audited({ action: 'phase_transition_rule.delete', entityType: 'phase_transition_rule' })
  @Endpoint({
    summary: 'Excluir regra de transição',
    tags: ['processes'],
    params: IdParams,
    status: 204,
  })
  async removeTransitionRule(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.processes.removeTransitionRule(user, params.id);
  }

  // ------------------------------------------------------------------------------------ SLAs ---

  @Post('boards/:boardId/slas')
  @Audited({ action: 'sla.create', entityType: 'sla' })
  @Endpoint({
    summary: 'Criar definição de SLA (do board, de um pipe ou de uma fase)',
    description: 'Requer `process.manage`.',
    tags: ['processes'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateSlaBody,
    response: S.SlaSchema,
    errors: [422],
  })
  createSla(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateSlaBody>,
  ) {
    return this.slas.create(user, params.boardId, body);
  }

  @Patch('slas/:id')
  @Audited({ action: 'sla.update', entityType: 'sla' })
  @Endpoint({
    summary: 'Atualizar definição de SLA',
    tags: ['processes'],
    params: IdParams,
    body: S.UpdateSlaBody,
    response: S.SlaSchema,
    errors: [422],
  })
  updateSla(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateSlaBody>,
  ) {
    return this.slas.update(user, params.id, body);
  }

  @Delete('slas/:id')
  @Audited({ action: 'sla.delete', entityType: 'sla' })
  @Endpoint({ summary: 'Excluir definição de SLA', tags: ['processes'], params: IdParams, status: 204 })
  async removeSla(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.slas.remove(user, params.id);
  }
}
