import { Injectable } from '@nestjs/common';
import { isoWeekStart } from '@cube-track/shared';
import { schema } from '@cube-track/db';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, NotFoundError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from '../../resources/application/workspace-scope.js';

const { items, timeEntries, timesheetApprovals } = schema;

type TimeEntryRow = typeof timeEntries.$inferSelect;

export interface TimeEntryDto {
  id: string;
  userId: string;
  boardId: string;
  itemId: string;
  entryDate: string;
  minutes: number;
  description: string | null;
  isBillable: boolean;
  source: 'manual' | 'timer' | 'import' | 'api';
  startedAt: string | null;
  endedAt: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  approvalId: string | null;
}

export interface CreateTimeEntryInput {
  boardId: string;
  itemId: string;
  entryDate: string;
  minutes: number;
  description?: string | null | undefined;
  isBillable?: boolean | undefined;
}

export interface UpdateTimeEntryInput {
  entryDate?: string | undefined;
  minutes?: number | undefined;
  description?: string | null | undefined;
  isBillable?: boolean | undefined;
}

function toDto(row: TimeEntryRow): TimeEntryDto {
  return {
    id: row.id,
    userId: row.userId,
    boardId: row.boardId,
    itemId: row.itemId,
    entryDate: row.entryDate,
    minutes: row.minutes,
    description: row.description,
    isBillable: row.isBillable,
    source: row.source,
    startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
    status: row.status,
    approvalId: row.approvalId,
  };
}

/**
 * Apontamento de horas em itens (ADR 0052): manual ou via cronômetro (o cronômetro em si vive na
 * coluna `time_tracking` do item — `ItemsService.timer` — que grava aqui ao parar, sem importar este
 * módulo: mesma decisão de `PhaseTransitionGuard`, consulta direto via schema).
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForUser(
    user: AuthPrincipal,
    targetUserId: string,
    range: { from: string; to: string },
  ): Promise<TimeEntryDto[]> {
    if (targetUserId !== user.userId) await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, targetUserId),
          isNull(timeEntries.deletedAt),
          gte(timeEntries.entryDate, range.from),
          lte(timeEntries.entryDate, range.to),
        ),
      )
      .orderBy(timeEntries.entryDate);
    return rows.map(toDto);
  }

  async listForItem(user: AuthPrincipal, itemId: string): Promise<TimeEntryDto[]> {
    await this.access.assert(user, 'item.read', await this.itemLocator(itemId), 'Item');
    const rows = await this.runner.tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.itemId, itemId), isNull(timeEntries.deletedAt)))
      .orderBy(timeEntries.entryDate);
    return rows.map(toDto);
  }

  async create(user: AuthPrincipal, input: CreateTimeEntryInput): Promise<TimeEntryDto> {
    if (!(input.minutes > 0 && input.minutes <= 1440))
      throw new ValidationError([{ path: 'body.minutes', message: 'Minutos devem ser maiores que 0 e no máximo 1440.' }]);
    await this.access.assert(user, 'item.update', await this.itemLocator(input.itemId), 'Item');
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId })
      .from(items)
      .where(eq(items.id, input.itemId));
    if (item?.boardId !== input.boardId)
      throw new ValidationError([{ path: 'body.itemId', message: 'Item não pertence a este board.' }]);
    await this.assertPeriodOpen(user.tenantId, user.userId, input.entryDate);
    const [row] = await this.runner.tx
      .insert(timeEntries)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        boardId: input.boardId,
        itemId: input.itemId,
        entryDate: input.entryDate,
        minutes: input.minutes,
        description: input.description ?? null,
        isBillable: input.isBillable ?? true,
        source: 'manual',
        status: 'draft',
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar apontamento.');
    this.events.recordChange({
      action: 'time_entry.create',
      entityType: 'time_entry',
      entityId: row.id,
      boardId: row.boardId,
      after: { entryDate: row.entryDate, minutes: row.minutes },
    });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateTimeEntryInput): Promise<TimeEntryDto> {
    const existing = await this.lockedForOwner(user, id);
    const entryDate = input.entryDate ?? existing.entryDate;
    if (input.minutes !== undefined && !(input.minutes > 0 && input.minutes <= 1440))
      throw new ValidationError([{ path: 'body.minutes', message: 'Minutos devem ser maiores que 0 e no máximo 1440.' }]);
    if (entryDate !== existing.entryDate) await this.assertPeriodOpen(user.tenantId, existing.userId, entryDate);
    const [row] = await this.runner.tx
      .update(timeEntries)
      .set({
        entryDate,
        minutes: input.minutes ?? existing.minutes,
        description: input.description === undefined ? existing.description : input.description,
        isBillable: input.isBillable ?? existing.isBillable,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar apontamento.');
    this.events.recordChange({
      action: 'time_entry.update',
      entityType: 'time_entry',
      entityId: row.id,
      boardId: row.boardId,
      before: { entryDate: existing.entryDate, minutes: existing.minutes },
      after: { entryDate: row.entryDate, minutes: row.minutes },
    });
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.lockedForOwner(user, id);
    await this.runner.tx.update(timeEntries).set({ deletedAt: new Date() }).where(eq(timeEntries.id, id));
    this.events.recordChange({ action: 'time_entry.delete', entityType: 'time_entry', entityId: id, boardId: existing.boardId });
    await this.emitChanged(user, existing, 'deleted');
  }

  /** Lança/atualiza em bloco os apontamentos de uma semana (apontamento semanal). */
  async logWeek(
    user: AuthPrincipal,
    entries: readonly CreateTimeEntryInput[],
  ): Promise<TimeEntryDto[]> {
    const created: TimeEntryDto[] = [];
    for (const entry of entries) created.push(await this.create(user, entry));
    return created;
  }

  private async lockedForOwner(user: AuthPrincipal, id: string): Promise<TimeEntryRow> {
    const [row] = await this.runner.tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), isNull(timeEntries.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Apontamento');
    if (row.userId !== user.userId) await this.assertManage(user);
    if (row.status === 'submitted' || row.status === 'approved')
      throw new UnprocessableError(
        'Não é possível alterar um apontamento já enviado ou aprovado.',
        'time_entry_locked',
      );
    return row;
  }

  /** Bloqueio de períodos fechados (ADR 0052): nenhum apontamento pode cair numa semana já aprovada. */
  private async assertPeriodOpen(tenantId: string, userId: string, entryDate: string): Promise<void> {
    const periodStart = isoWeekStart(entryDate);
    const [approval] = await this.runner.tx
      .select({ status: timesheetApprovals.status })
      .from(timesheetApprovals)
      .where(
        and(
          eq(timesheetApprovals.tenantId, tenantId),
          eq(timesheetApprovals.userId, userId),
          eq(timesheetApprovals.periodStart, periodStart),
        ),
      );
    if (approval?.status === 'approved')
      throw new UnprocessableError('Este período já foi aprovado e está fechado para apontamentos.', 'period_closed');
  }

  private async itemLocator(itemId: string) {
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId, values: items.values })
      .from(items)
      .where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    return { type: 'item' as const, item: { id: item.id, boardId: item.boardId, values: item.values as Record<string, unknown> } };
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<TimeEntryRow, 'id' | 'userId' | 'boardId' | 'itemId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'time_entry.changed',
      aggregateType: 'time_entry',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { timeEntryId: row.id, userId: row.userId, boardId: row.boardId, itemId: row.itemId, change },
      actorId: user.userId,
    });
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    const allowed = await this.access.can(user, 'timesheet.approve', { type: 'workspace', id: workspaceId });
    if (!allowed) throw new ForbiddenError();
  }
}

export type { TimeEntryRow };
