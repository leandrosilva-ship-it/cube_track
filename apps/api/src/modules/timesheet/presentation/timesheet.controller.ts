import { Controller, Delete, Get, Patch, Post, StreamableFile } from '@nestjs/common';
import { toCsv } from '@cube-track/shared';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { TimeEntriesService } from '../application/time-entries.service.js';
import { TimesheetApprovalsService } from '../application/timesheet-approvals.service.js';
import * as S from './schemas.js';

/** Apontamento de horas e aprovação de timesheet (ADR 0052). */
@Controller()
export class TimesheetController {
  constructor(
    private readonly entries: TimeEntriesService,
    private readonly approvals: TimesheetApprovalsService,
  ) {}

  // ----------------------------------------------------------------------------- time entries ---

  @Get('users/:userId/time-entries')
  @Endpoint({
    summary: 'Listar apontamentos de uma pessoa num período',
    description: 'A própria pessoa pode ver os seus; ver os de outra exige `timesheet.approve`.',
    tags: ['timesheet'],
    params: S.UserParams,
    query: S.UserRangeQuery,
    response: z.object({ data: z.array(S.TimeEntrySchema) }),
  })
  async listForUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
    @Input('query') query: z.infer<typeof S.UserRangeQuery>,
  ) {
    return { data: await this.entries.listForUser(user, params.userId, query) };
  }

  @Get('items/:itemId/time-entries')
  @Endpoint({
    summary: 'Listar apontamentos de um item',
    tags: ['timesheet'],
    params: S.ItemParams,
    response: z.object({ data: z.array(S.TimeEntrySchema) }),
  })
  async listForItem(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ItemParams>) {
    return { data: await this.entries.listForItem(user, params.itemId) };
  }

  @Post('time-entries')
  @Audited({ action: 'time_entry.create', entityType: 'time_entry' })
  @Endpoint({
    summary: 'Lançar um apontamento manual de horas',
    tags: ['timesheet'],
    status: 201,
    body: S.CreateTimeEntryBody,
    response: S.TimeEntrySchema,
  })
  create(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.CreateTimeEntryBody>) {
    return this.entries.create(user, body);
  }

  @Post('time-entries/week')
  @Audited({ action: 'time_entry.create', entityType: 'time_entry' })
  @Endpoint({
    summary: 'Lançar vários apontamentos de uma vez (apontamento semanal)',
    tags: ['timesheet'],
    status: 201,
    body: S.LogWeekBody,
    response: z.object({ data: z.array(S.TimeEntrySchema) }),
  })
  async logWeek(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.LogWeekBody>) {
    return { data: await this.entries.logWeek(user, body.entries) };
  }

  @Patch('time-entries/:id')
  @Audited({ action: 'time_entry.update', entityType: 'time_entry' })
  @Endpoint({
    summary: 'Atualizar um apontamento (enquanto não enviado/aprovado)',
    tags: ['timesheet'],
    params: IdParams,
    body: S.UpdateTimeEntryBody,
    response: S.TimeEntrySchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateTimeEntryBody>,
  ) {
    return this.entries.update(user, params.id, body);
  }

  @Delete('time-entries/:id')
  @Audited({ action: 'time_entry.delete', entityType: 'time_entry' })
  @Endpoint({ summary: 'Excluir um apontamento (enquanto não enviado/aprovado)', tags: ['timesheet'], params: IdParams, status: 204 })
  async remove(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    await this.entries.remove(user, params.id);
  }

  @Get('users/:userId/time-entries/export.csv')
  @Endpoint({
    summary: 'Exportar os apontamentos de uma pessoa num período em CSV',
    description: 'A própria pessoa pode exportar os seus; exportar os de outra exige `timesheet.approve`.',
    tags: ['timesheet'],
    params: S.UserParams,
    query: S.ExportQuery,
  })
  async exportCsv(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
    @Input('query') query: z.infer<typeof S.ExportQuery>,
  ) {
    const rows = await this.entries.listForUser(user, params.userId, query);
    const header = ['Data', 'Board', 'Item', 'Minutos', 'Faturável', 'Origem', 'Status', 'Descrição'];
    const csv = toCsv(
      header,
      rows.map((row) => [
        row.entryDate,
        row.boardId,
        row.itemId,
        String(row.minutes),
        row.isBillable ? 'Sim' : 'Não',
        row.source,
        row.status,
        row.description ?? '',
      ]),
      'pt-BR',
    );
    const body = Buffer.from(csv, 'utf-8');
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="timesheet_${params.userId}_${query.from}_${query.to}.csv"`,
      length: body.byteLength,
    });
  }

  // -------------------------------------------------------------------------------- approvals ---

  @Get('users/:userId/timesheet-approvals')
  @Endpoint({
    summary: 'Listar as semanas de timesheet de uma pessoa',
    tags: ['timesheet'],
    params: S.UserParams,
    response: z.object({ data: z.array(S.TimesheetApprovalSchema) }),
  })
  async listApprovalsForUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.UserParams>,
  ) {
    return { data: await this.approvals.listForUser(user, params.userId) };
  }

  @Get('timesheet-approvals/pending')
  @Endpoint({
    summary: 'Listar semanas de timesheet pendentes de aprovação',
    description: 'Requer `timesheet.approve`.',
    tags: ['timesheet'],
    response: z.object({ data: z.array(S.TimesheetApprovalSchema) }),
  })
  async listPending(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.approvals.listPending(user) };
  }

  @Post('timesheet-approvals/submit')
  @Audited({ action: 'timesheet_approval.submit', entityType: 'timesheet_approval' })
  @Endpoint({
    summary: 'Enviar a própria semana de timesheet para aprovação',
    tags: ['timesheet'],
    status: 201,
    body: S.SubmitWeekBody,
    response: S.TimesheetApprovalSchema,
  })
  submit(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.SubmitWeekBody>) {
    return this.approvals.submit(user, body.periodStart);
  }

  @Post('timesheet-approvals/:id/decide')
  @Audited({ action: 'timesheet_approval.decide', entityType: 'timesheet_approval' })
  @Endpoint({
    summary: 'Aprovar/recusar a semana de timesheet de uma pessoa',
    description: 'Requer `timesheet.approve`.',
    tags: ['timesheet'],
    status: 200,
    params: IdParams,
    body: S.DecideApprovalBody,
    response: S.TimesheetApprovalSchema,
  })
  decide(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.DecideApprovalBody>,
  ) {
    return this.approvals.decide(user, params.id, body.status, body.comment);
  }
}
