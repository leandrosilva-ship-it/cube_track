import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from './workspace-scope.js';

const { absences } = schema;

type AbsenceRow = typeof absences.$inferSelect;

export interface AbsenceDto {
  id: string;
  userId: string;
  type: 'vacation' | 'sick_leave' | 'training' | 'day_off' | 'other';
  startDate: string;
  endDate: string;
  hoursPerDay: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
}

export interface RequestAbsenceInput {
  startDate: string;
  endDate: string;
  type: 'vacation' | 'sick_leave' | 'training' | 'day_off' | 'other';
  hoursPerDay?: string | null | undefined;
  notes?: string | null | undefined;
}

function toDto(row: AbsenceRow): AbsenceDto {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    startDate: row.startDate,
    endDate: row.endDate,
    hoursPerDay: row.hoursPerDay,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt === null ? null : row.approvedAt.toISOString(),
    notes: row.notes,
  };
}

/** Ausências (férias, licenças, treinamentos, folgas) que reduzem a capacidade disponível (ADR 0052). */
@Injectable()
export class AbsencesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForUser(user: AuthPrincipal, targetUserId: string): Promise<AbsenceDto[]> {
    if (targetUserId !== user.userId) await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(absences)
      .where(and(eq(absences.userId, targetUserId), isNull(absences.deletedAt)));
    return rows.map(toDto);
  }

  /** Fila de aprovação: todas as ausências `submitted` do tenant — requer `resources.manage`/`timesheet.approve`. */
  async pending(user: AuthPrincipal): Promise<AbsenceDto[]> {
    await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(absences)
      .where(and(eq(absences.status, 'submitted'), isNull(absences.deletedAt)));
    return rows.map(toDto);
  }

  /** Alguém solicita a própria ausência; entra como rascunho enviado para aprovação. */
  async request(user: AuthPrincipal, input: RequestAbsenceInput): Promise<AbsenceDto> {
    if (input.endDate < input.startDate)
      throw new ValidationError([{ path: 'body.endDate', message: 'O fim não pode ser antes do início.' }]);
    const [row] = await this.runner.tx
      .insert(absences)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        type: input.type,
        startDate: input.startDate,
        endDate: input.endDate,
        hoursPerDay: input.hoursPerDay ?? null,
        status: 'submitted',
        notes: input.notes ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao solicitar ausência.');
    this.events.recordChange({
      action: 'absence.request',
      entityType: 'absence',
      entityId: row.id,
      after: { userId: row.userId, type: row.type, startDate: row.startDate, endDate: row.endDate },
    });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async decide(
    user: AuthPrincipal,
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<AbsenceDto> {
    await this.assertManage(user);
    const existing = await this.locked(id);
    if (existing.status !== 'submitted')
      throw new ValidationError([
        { path: 'body.status', message: 'Só é possível decidir sobre ausências enviadas.' },
      ]);
    const [row] = await this.runner.tx
      .update(absences)
      .set({
        status: decision,
        approvedBy: user.userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(absences.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao decidir sobre a ausência.');
    this.events.recordChange({
      action: `absence.${decision}`,
      entityType: 'absence',
      entityId: row.id,
      before: { status: existing.status },
      after: { status: row.status },
    });
    await this.emitChanged(user, row, decision);
    return toDto(row);
  }

  /** Cancela a própria solicitação, enquanto ainda não foi decidida. */
  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    if (existing.userId !== user.userId) await this.assertManage(user);
    if (existing.userId === user.userId && !['draft', 'submitted'].includes(existing.status))
      throw new ValidationError([
        { path: 'body.status', message: 'Só é possível cancelar ausências ainda não decididas.' },
      ]);
    await this.runner.tx.update(absences).set({ deletedAt: new Date() }).where(eq(absences.id, id));
    this.events.recordChange({ action: 'absence.delete', entityType: 'absence', entityId: id });
    await this.emitChanged(user, existing, 'deleted');
  }

  /** Ausências de um usuário sobrepondo `[from, to]` com status aprovado — uso interno do motor de capacidade. */
  async approvedForUser(targetUserId: string, from: string, to: string): Promise<AbsenceRow[]> {
    return this.runner.tx
      .select()
      .from(absences)
      .where(
        and(eq(absences.userId, targetUserId), eq(absences.status, 'approved'), isNull(absences.deletedAt)),
      )
      .then((rows) => rows.filter((row) => row.endDate >= from && row.startDate <= to));
  }

  private async locked(id: string): Promise<AbsenceRow> {
    const [row] = await this.runner.tx
      .select()
      .from(absences)
      .where(and(eq(absences.id, id), isNull(absences.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Ausência');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<AbsenceRow, 'id' | 'userId'>,
    change: 'created' | 'updated' | 'approved' | 'rejected' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'absence.changed',
      aggregateType: 'absence',
      aggregateId: row.id,
      payload: { absenceId: row.id, userId: row.userId, change },
      actorId: user.userId,
    });
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    const allowed = await this.access.can(user, 'resources.manage', { type: 'workspace', id: workspaceId });
    if (allowed) return;
    const canApprove = await this.access.can(user, 'timesheet.approve', {
      type: 'workspace',
      id: workspaceId,
    });
    if (!canApprove) throw new ForbiddenError();
  }
}

export type { AbsenceRow };
