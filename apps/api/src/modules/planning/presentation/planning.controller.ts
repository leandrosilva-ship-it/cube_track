import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { BaselinesService } from '../application/baselines.service.js';
import { GanttService } from '../application/gantt.service.js';
import { MilestonesService } from '../application/milestones.service.js';
import { ScheduleImportService } from '../application/schedule-import.service.js';
import * as S from './schemas.js';

@Controller()
export class PlanningController {
  constructor(
    private readonly ganttService: GanttService,
    private readonly milestones: MilestonesService,
    private readonly baselines: BaselinesService,
    private readonly scheduleImport: ScheduleImportService,
  ) {}

  // ---------------------------------------------------------------------------- cronograma ---

  @Get('boards/:boardId/gantt')
  @Endpoint({
    summary: 'Dados do Gantt/Cronograma: tarefas com EAP, dependências e caminho crítico',
    description:
      'Numeração EAP derivada (grupo + hierarquia de subitens), caminho crítico recalculado ' +
      'pelo CPM sobre o calendário de dias úteis do board (ADR 0049).',
    tags: ['planning'],
    params: S.BoardParams,
    response: S.GanttResponseSchema,
  })
  gantt(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return this.ganttService.data(user, params.boardId);
  }

  // --------------------------------------------------------------------------------- marcos ---

  @Get('boards/:boardId/milestones')
  @Endpoint({
    summary: 'Listar marcos do board',
    tags: ['planning'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.MilestoneSchema) }),
  })
  async milestonesOf(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.milestones.list(user, params.boardId) };
  }

  @Post('boards/:boardId/milestones')
  @Audited({ action: 'milestone.create', entityType: 'milestone' })
  @Endpoint({
    summary: 'Criar marco',
    description: 'Requer `schedule.manage` no board. Pode opcionalmente vincular a um item.',
    tags: ['planning'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateMilestoneBody,
    response: S.MilestoneSchema,
  })
  createMilestone(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateMilestoneBody>,
  ) {
    return this.milestones.create(user, params.boardId, body);
  }

  @Patch('milestones/:id')
  @Audited({ action: 'milestone.update', entityType: 'milestone' })
  @Endpoint({
    summary: 'Atualizar marco',
    tags: ['planning'],
    params: IdParams,
    body: S.UpdateMilestoneBody,
    response: S.MilestoneSchema,
  })
  updateMilestone(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateMilestoneBody>,
  ) {
    return this.milestones.update(user, params.id, body);
  }

  @Delete('milestones/:id')
  @Audited({ action: 'milestone.delete', entityType: 'milestone' })
  @Endpoint({ summary: 'Excluir marco', tags: ['planning'], params: IdParams, status: 204 })
  async deleteMilestone(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.milestones.remove(user, params.id);
  }

  // ------------------------------------------------------------------------------ baselines ---

  @Get('boards/:boardId/baselines')
  @Endpoint({
    summary: 'Listar baselines do board',
    tags: ['planning'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.BaselineSchema) }),
  })
  async baselinesOf(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.baselines.list(user, params.boardId) };
  }

  @Post('boards/:boardId/baselines')
  @Audited({ action: 'baseline.capture', entityType: 'baseline' })
  @Endpoint({
    summary: 'Capturar baseline (fotografia do cronograma vigente)',
    description:
      'Requer `schedule.manage` no board. Grava planejado atual de cada item ativo para ' +
      'comparação futura (planejado × replanejado × realizado).',
    tags: ['planning'],
    status: 201,
    params: S.BoardParams,
    body: S.CaptureBaselineBody,
    response: S.BaselineSchema,
  })
  captureBaseline(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CaptureBaselineBody>,
  ) {
    return this.baselines.capture(user, params.boardId, body);
  }

  @Get('baselines/:id')
  @Endpoint({
    summary: 'Detalhe da baseline com comparação por item',
    tags: ['planning'],
    params: IdParams,
    response: S.BaselineDetailSchema,
  })
  baseline(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return this.baselines.get(user, params.id);
  }

  @Post('baselines/:id/primary')
  @Audited({ action: 'baseline.set_primary', entityType: 'baseline' })
  @Endpoint({
    summary: 'Marcar baseline como primária do board',
    tags: ['planning'],
    params: IdParams,
    response: S.BaselineSchema,
  })
  setPrimaryBaseline(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return this.baselines.setPrimary(user, params.id);
  }

  @Delete('baselines/:id')
  @Audited({ action: 'baseline.delete', entityType: 'baseline' })
  @Endpoint({ summary: 'Excluir baseline', tags: ['planning'], params: IdParams, status: 204 })
  async deleteBaseline(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.baselines.remove(user, params.id);
  }

  // --------------------------------------------------------------- import de cronograma (MSP) ---

  @Post('boards/:boardId/schedule-imports')
  @Audited({ action: 'schedule_import.preview', entityType: 'board' })
  @Endpoint({
    summary: 'Prévia de importação de cronograma MS Project (.xml/MSPDI)',
    description:
      'Requer `schedule.manage`. `.mpp` não é suportado (binário proprietário). A prévia fica ' +
      'disponível por 30 min para confirmar com `POST .../commit`.',
    tags: ['planning'],
    status: 201,
    params: S.BoardParams,
    body: S.ScheduleImportUploadBody,
    response: S.SchedulePreviewSchema,
    errors: [413, 422],
  })
  previewScheduleImport(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.ScheduleImportUploadBody>,
  ) {
    return this.scheduleImport.preview(user, params.boardId, body);
  }

  @Post('boards/:boardId/schedule-imports/:importId/commit')
  @Audited({ action: 'schedule_import.commit', entityType: 'board' })
  @Endpoint({
    summary: 'Confirma a importação: cria os itens e as dependências entre eles',
    status: 200,
    tags: ['planning'],
    params: S.ImportParams,
    body: S.ScheduleImportCommitBody,
    response: S.ScheduleImportResultSchema,
  })
  commitScheduleImport(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ImportParams>,
    @Input('body') body: z.infer<typeof S.ScheduleImportCommitBody>,
  ) {
    return this.scheduleImport.commit(user, params.boardId, params.importId, body.groupId);
  }
}
