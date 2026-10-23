import { Controller, Delete, Get, Patch, Post, StreamableFile } from '@nestjs/common';
import { toCsv } from '@cube-track/shared';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { DashboardsService } from '../application/dashboards.service.js';
import { ProjectHealthService } from '../application/project-health.service.js';
import { widgetDataToCsvRows } from '../application/widget-csv.js';
import { WidgetDataService } from '../application/widget-data.service.js';
import { WidgetsService } from '../application/widgets.service.js';
import * as S from './schemas.js';

@Controller()
export class DashboardsController {
  constructor(
    private readonly dashboards: DashboardsService,
    private readonly widgets: WidgetsService,
    private readonly widgetData: WidgetDataService,
    private readonly projectHealth: ProjectHealthService,
  ) {}

  // ----------------------------------------------------------------------------- dashboards ---

  @Get('workspaces/:workspaceId/dashboards')
  @Endpoint({
    summary: 'Listar dashboards visíveis no workspace',
    description: 'Dashboards privados do dono, mais os de visibilidade `workspace` (ADR 0050).',
    tags: ['dashboards'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.DashboardSchema) }),
  })
  async listDashboards(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
  ) {
    return { data: await this.dashboards.listByWorkspace(user, params.workspaceId) };
  }

  @Post('workspaces/:workspaceId/dashboards')
  @Audited({ action: 'dashboard.create', entityType: 'dashboard' })
  @Endpoint({
    summary: 'Criar dashboard',
    description: 'Requer `dashboard.create` no workspace.',
    tags: ['dashboards'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateDashboardBody,
    response: S.DashboardSchema,
  })
  createDashboard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateDashboardBody>,
  ) {
    return this.dashboards.create(user, params.workspaceId, body);
  }

  @Get('dashboards/:id')
  @Endpoint({
    summary: 'Detalhe do dashboard',
    tags: ['dashboards'],
    params: IdParams,
    response: S.DashboardSchema,
  })
  dashboard(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    return this.dashboards.get(user, params.id);
  }

  @Patch('dashboards/:id')
  @Audited({ action: 'dashboard.update', entityType: 'dashboard' })
  @Endpoint({
    summary: 'Atualizar dashboard',
    description: 'Requer ser o dono ou ter `workspace.manage` (ADR 0050).',
    tags: ['dashboards'],
    params: IdParams,
    body: S.UpdateDashboardBody,
    response: S.DashboardSchema,
  })
  updateDashboard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateDashboardBody>,
  ) {
    return this.dashboards.update(user, params.id, body);
  }

  @Delete('dashboards/:id')
  @Audited({ action: 'dashboard.delete', entityType: 'dashboard' })
  @Endpoint({ summary: 'Excluir dashboard', tags: ['dashboards'], params: IdParams, status: 204 })
  async deleteDashboard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.dashboards.remove(user, params.id);
  }

  // -------------------------------------------------------------------------------- widgets ---

  @Get('dashboards/:id/widgets')
  @Endpoint({
    summary: 'Listar widgets do dashboard',
    tags: ['dashboards'],
    params: IdParams,
    response: z.object({ data: z.array(S.WidgetSchema) }),
  })
  async listWidgets(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return { data: await this.widgets.listByDashboard(user, params.id) };
  }

  @Post('dashboards/:id/widgets')
  @Audited({ action: 'widget.create', entityType: 'widget' })
  @Endpoint({
    summary: 'Criar widget',
    description: 'Requer `dashboard.update`. `config` é validado conforme `type` (packages/shared/src/widgets.ts).',
    tags: ['dashboards'],
    status: 201,
    params: IdParams,
    body: S.CreateWidgetBody,
    response: S.WidgetSchema,
    errors: [422],
  })
  createWidget(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.CreateWidgetBody>,
  ) {
    return this.widgets.create(user, params.id, body);
  }

  @Patch('widgets/:id')
  @Audited({ action: 'widget.update', entityType: 'widget' })
  @Endpoint({
    summary: 'Atualizar widget (título, configuração ou posição na grade)',
    tags: ['dashboards'],
    params: IdParams,
    body: S.UpdateWidgetBody,
    response: S.WidgetSchema,
    errors: [422],
  })
  updateWidget(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateWidgetBody>,
  ) {
    return this.widgets.update(user, params.id, body);
  }

  @Delete('widgets/:id')
  @Audited({ action: 'widget.delete', entityType: 'widget' })
  @Endpoint({ summary: 'Excluir widget', tags: ['dashboards'], params: IdParams, status: 204 })
  async deleteWidget(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.widgets.remove(user, params.id);
  }

  // ----------------------------------------------------------------------------------- dados ---

  @Get('dashboards/:id/data')
  @Endpoint({
    summary: 'Dados computados de todos os widgets do dashboard',
    description:
      'Agregação feita no servidor (reaproveita `ItemsService`/`ItemQueryBuilder`, mesmas ' +
      'permissões e colunas ocultas da Tabela). O cliente nunca recalcula (ADR 0050).',
    tags: ['dashboards'],
    params: IdParams,
    response: S.DashboardDataResponseSchema,
  })
  async data(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    const widgets = await this.widgets.listByDashboard(user, params.id);
    const data = await Promise.all(
      widgets.map(async (widget) => ({
        widgetId: widget.id,
        type: widget.type,
        data: await this.widgetData.compute(user, widget),
      })),
    );
    return { data };
  }

  @Get('widgets/:id/export.csv')
  @Endpoint({
    summary: 'Exportar os dados computados de um widget em CSV',
    tags: ['dashboards'],
    params: IdParams,
  })
  async exportWidget(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    const widget = await this.widgets.getChecked(user, params.id);
    const data = await this.widgetData.compute(user, widget);
    const { header, rows } = widgetDataToCsvRows(widget.title, data);
    const csv = toCsv(header, rows, 'pt-BR');
    const body = Buffer.from(csv, 'utf-8');
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${widget.title.replace(/[^\w.-]+/g, '_')}.csv"`,
      length: body.byteLength,
    });
  }

  // ---------------------------------------------------------------------- saúde do projeto ---

  @Get('boards/:boardId/project-health')
  @Endpoint({
    summary: 'Histórico de saúde do projeto (board)',
    tags: ['dashboards'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.ProjectHealthEntrySchema) }),
  })
  async projectHealthHistory(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.projectHealth.history(user, params.boardId) };
  }

  @Post('boards/:boardId/project-health')
  @Audited({ action: 'project_health.report', entityType: 'project_health' })
  @Endpoint({
    summary: 'Relatar a saúde do projeto',
    description: 'Requer `board.manage`. Série histórica append-only, sempre manual (ADR 0050).',
    tags: ['dashboards'],
    status: 201,
    params: S.BoardParams,
    body: S.ReportProjectHealthBody,
    response: S.ProjectHealthEntrySchema,
  })
  reportProjectHealth(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.ReportProjectHealthBody>,
  ) {
    return this.projectHealth.report(user, params.boardId, body);
  }
}
