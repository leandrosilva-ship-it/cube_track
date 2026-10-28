import { Injectable } from '@nestjs/common';
import { isoWeekStart, shiftDays } from '@cube-track/shared';
import { schema } from '@cube-track/db';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from '../../resources/application/workspace-scope.js';

const { timeEntries, timesheetApprovals } = schema;

type ApprovalRow = typeof timesheetApprovals.$inferSelect;

export interface TimesheetApprovalDto {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  totalMinutes: number;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment: string | null;
}

function toDto(row: ApprovalRow): TimesheetApprovalDto {
  return {
    id: row.id,
    userId: row.userId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    totalMinutes: row.totalMinutes,
    submittedAt: row.submittedAt === null ? null : row.submittedAt.toISOString(),
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt === null ? null : row.reviewedAt.toISOString(),
    comment: row.comment,
  };
}

/**
 * Aprovação de timesheet por semana (ADR 0052): a pessoa envia a semana (congela as horas enviadas
 * no total e trava novos apontamentos naquele período assim que aprovado); o gestor aprova ou recusa.
 */
@Injectable()
export class TimesheetApprovalsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForUser(user: AuthPrincipal, targetUserId: string): Promise<TimesheetApprovalDto[]> {
    if (targetUserId !== user.userId) await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(timesheetApprovals)
      .where(eq(timesheetApprovals.userId, targetUserId))
      .orderBy(timesheetApprovals.periodStart);
    return rows.map(toDto);
  }

  /** Lista todas as semanas pendentes de aprovação do tenant — requer `timesheet.approve`. */
  async listPending(user: AuthPrincipal): Promise<TimesheetApprovalDto[]> {
    await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(timesheetApprovals)
      .where(eq(timesheetApprovals.status, 'submitted'))
      .orderBy(timesheetApprovals.periodStart);
    return rows.map(toDto);
  }

  /** Envia a própria semana: soma os apontamentos não excluídos do período e os trava para edição. */
  async submit(user: AuthPrincipal, periodStart: string): Promise<TimesheetApprovalDto> {
    if (periodStart !== isoWeekStart(periodStart))
      throw new ValidationError([{ path: 'body.periodStart', message: 'periodStart deve ser uma segunda-feira.' }]);
    const periodEnd = shiftDays(periodStart, 6);
    const entries = await this.runner.tx
      .select({ id: timeEntries.id, minutes: timeEntries.minutes })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, user.userId),
          isNull(timeEntries.deletedAt),
          gte(timeEntries.entryDate, periodStart),
          lte(timeEntries.entryDate, periodEnd),
        ),
      );
    if (entries.length === 0)
      throw new ValidationError([{ path: 'body.periodStart', message: 'Não há apontamentos nesta semana.' }]);
    const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
    const [row] = await this.runner.tx
      .insert(timesheetApprovals)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        periodStart,
        periodEnd,
        status: 'submitted',
        totalMinutes,
        submittedAt: new Date(),
        createdBy: user.userId,
      })
      .onConflictDoUpdate({
        target: [timesheetApprovals.tenantId, timesheetApprovals.userId, timesheetApprovals.periodStart],
        set: { status: 'submitted', totalMinutes, submittedAt: new Date(), reviewedBy: null, reviewedAt: null, comment: null },
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao enviar o timesheet da semana.');
    await this.runner.tx
      .update(timeEntries)
      .set({ status: 'submitted', approvalId: row.id })
      .where(
        and(
          eq(timeEntries.userId, user.userId),
          isNull(timeEntries.deletedAt),
          gte(timeEntries.entryDate, periodStart),
          lte(timeEntries.entryDate, periodEnd),
        ),
      );
    this.events.recordChange({
      action: 'timesheet_approval.submit',
      entityType: 'timesheet_approval',
      entityId: row.id,
      after: { periodStart: row.periodStart, totalMinutes: row.totalMinutes },
    });
    await this.emitChanged(user, row);
    return toDto(row);
  }

  async decide(
    user: AuthPrincipal,
    id: string,
    decision: 'approved' | 'rejected',
    comment?: string | null,
  ): Promise<TimesheetApprovalDto> {
    await this.assertManage(user);
    const [existing] = await this.runner.tx
      .select()
      .from(timesheetApprovals)
      .where(eq(timesheetApprovals.id, id))
      .for('update');
    if (existing === undefined) throw new NotFoundError('Aprovação de timesheet');
    if (existing.status !== 'submitted')
      throw new ValidationError([{ path: 'body.status', message: 'Só é possível decidir sobre semanas enviadas.' }]);
    const [row] = await this.runner.tx
      .update(timesheetApprovals)
      .set({ status: decision, reviewedBy: user.userId, reviewedAt: new Date(), comment: comment ?? null })
      .where(eq(timesheetApprovals.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao decidir sobre o timesheet.');
    await this.runner.tx
      .update(timeEntries)
      .set({ status: decision === 'approved' ? 'approved' : 'draft', approvalId: decision === 'approved' ? row.id : null })
      .where(eq(timeEntries.approvalId, id));
    this.events.recordChange({
      action: `timesheet_approval.${decision}`,
      entityType: 'timesheet_approval',
      entityId: row.id,
      before: { status: existing.status },
      after: { status: row.status },
    });
    await this.emitChanged(user, row);
    return toDto(row);
  }

  private async emitChanged(user: AuthPrincipal, row: Pick<ApprovalRow, 'id' | 'userId' | 'periodStart' | 'status'>): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'timesheet_approval.changed',
      aggregateType: 'timesheet_approval',
      aggregateId: row.id,
      payload: { approvalId: row.id, userId: row.userId, periodStart: row.periodStart, status: row.status },
      actorId: user.userId,
    });
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'timesheet.approve', { type: 'workspace', id: workspaceId }, 'Workspace');
  }
}

export type { ApprovalRow };
