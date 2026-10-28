import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from './workspace-scope.js';

const { allocations, boards, items } = schema;

type AllocationRow = typeof allocations.$inferSelect;

export interface AllocationDto {
  id: string;
  userId: string;
  boardId: string;
  itemId: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: string;
  status: 'tentative' | 'confirmed';
  notes: string | null;
}

export interface AllocationInput {
  userId: string;
  boardId: string;
  itemId?: string | null | undefined;
  startDate: string;
  endDate: string;
  hoursPerDay: string;
  status?: 'tentative' | 'confirmed' | undefined;
  notes?: string | null | undefined;
}

export interface UpdateAllocationInput {
  startDate?: string | undefined;
  endDate?: string | undefined;
  hoursPerDay?: string | undefined;
  status?: 'tentative' | 'confirmed' | undefined;
  notes?: string | null | undefined;
}

function toDto(row: AllocationRow): AllocationDto {
  return {
    id: row.id,
    userId: row.userId,
    boardId: row.boardId,
    itemId: row.itemId,
    startDate: row.startDate,
    endDate: row.endDate,
    hoursPerDay: row.hoursPerDay,
    status: row.status,
    notes: row.notes,
  };
}

function assertDates(startDate: string, endDate: string): void {
  if (endDate < startDate)
    throw new ValidationError([{ path: 'body.endDate', message: 'O fim não pode ser antes do início.' }]);
}

function assertHours(hoursPerDay: string): void {
  const value = Number(hoursPerDay);
  if (!(value > 0 && value <= 24))
    throw new ValidationError([
      { path: 'body.hoursPerDay', message: 'Horas por dia devem ser maiores que 0 e no máximo 24.' },
    ]);
}

/**
 * Alocações planejadas (ADR 0052) — construto informativo, independente do campo Responsável
 * (coluna `people`) do item: uma pessoa pode estar alocada sem aparecer como responsável, e
 * vice-versa. Nunca bloqueia por sobrealocação — isso é sinalizado visualmente (heatmap), não impedido.
 */
@Injectable()
export class AllocationsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForBoard(
    user: AuthPrincipal,
    boardId: string,
    range: { from?: string | undefined; to?: string | undefined },
  ): Promise<AllocationDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const conditions = [eq(allocations.boardId, boardId), isNull(allocations.deletedAt)];
    if (range.from !== undefined) conditions.push(gte(allocations.endDate, range.from));
    if (range.to !== undefined) conditions.push(lte(allocations.startDate, range.to));
    const rows = await this.runner.tx
      .select()
      .from(allocations)
      .where(and(...conditions))
      .orderBy(desc(allocations.startDate));
    return rows.map(toDto);
  }

  async listForUser(
    user: AuthPrincipal,
    targetUserId: string,
    range: { from: string; to: string },
  ): Promise<AllocationDto[]> {
    if (targetUserId !== user.userId) await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(allocations)
      .where(
        and(
          eq(allocations.userId, targetUserId),
          isNull(allocations.deletedAt),
          gte(allocations.endDate, range.from),
          lte(allocations.startDate, range.to),
        ),
      )
      .orderBy(desc(allocations.startDate));
    return rows.map(toDto);
  }

  async create(user: AuthPrincipal, input: AllocationInput): Promise<AllocationDto> {
    await this.assertManage(user);
    assertDates(input.startDate, input.endDate);
    assertHours(input.hoursPerDay);
    const [board] = await this.runner.tx
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.id, input.boardId));
    if (board === undefined) throw new NotFoundError('Board');
    if (input.itemId !== undefined && input.itemId !== null) {
      const [item] = await this.runner.tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, input.itemId), eq(items.boardId, input.boardId)));
      if (item === undefined)
        throw new ValidationError([{ path: 'body.itemId', message: 'Item não pertence a este board.' }]);
    }
    const [row] = await this.runner.tx
      .insert(allocations)
      .values({
        tenantId: user.tenantId,
        userId: input.userId,
        boardId: input.boardId,
        itemId: input.itemId ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        hoursPerDay: input.hoursPerDay,
        status: input.status ?? 'confirmed',
        notes: input.notes ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar alocação.');
    this.events.recordChange({
      action: 'allocation.create',
      entityType: 'allocation',
      entityId: row.id,
      boardId: row.boardId,
      after: { userId: row.userId, startDate: row.startDate, endDate: row.endDate, hoursPerDay: row.hoursPerDay },
    });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateAllocationInput): Promise<AllocationDto> {
    await this.assertManage(user);
    const existing = await this.locked(id);
    const startDate = input.startDate ?? existing.startDate;
    const endDate = input.endDate ?? existing.endDate;
    assertDates(startDate, endDate);
    if (input.hoursPerDay !== undefined) assertHours(input.hoursPerDay);
    const [row] = await this.runner.tx
      .update(allocations)
      .set({
        startDate,
        endDate,
        hoursPerDay: input.hoursPerDay ?? existing.hoursPerDay,
        status: input.status ?? existing.status,
        notes: input.notes === undefined ? existing.notes : input.notes,
        updatedAt: new Date(),
      })
      .where(eq(allocations.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar alocação.');
    this.events.recordChange({
      action: 'allocation.update',
      entityType: 'allocation',
      entityId: row.id,
      boardId: row.boardId,
      before: { startDate: existing.startDate, endDate: existing.endDate, hoursPerDay: existing.hoursPerDay },
      after: { startDate: row.startDate, endDate: row.endDate, hoursPerDay: row.hoursPerDay },
    });
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    await this.assertManage(user);
    const existing = await this.locked(id);
    await this.runner.tx
      .update(allocations)
      .set({ deletedAt: new Date() })
      .where(eq(allocations.id, id));
    this.events.recordChange({
      action: 'allocation.delete',
      entityType: 'allocation',
      entityId: id,
      boardId: existing.boardId,
    });
    await this.emitChanged(user, existing, 'deleted');
  }

  /** Alocações de vários usuários sobrepondo `[from, to]`, cruas (sem DTO) — uso interno do heatmap. */
  async rawForUsers(userIds: readonly string[], from: string, to: string): Promise<AllocationRow[]> {
    if (userIds.length === 0) return [];
    return this.runner.tx
      .select()
      .from(allocations)
      .where(
        and(
          isNull(allocations.deletedAt),
          gte(allocations.endDate, from),
          lte(allocations.startDate, to),
          or(...userIds.map((userId) => eq(allocations.userId, userId))),
        ),
      );
  }

  private async locked(id: string): Promise<AllocationRow> {
    const [row] = await this.runner.tx
      .select()
      .from(allocations)
      .where(and(eq(allocations.id, id), isNull(allocations.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Alocação');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<AllocationRow, 'id' | 'userId' | 'boardId' | 'itemId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'allocation.changed',
      aggregateType: 'allocation',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { allocationId: row.id, userId: row.userId, boardId: row.boardId, itemId: row.itemId, change },
      actorId: user.userId,
    });
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'resources.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
  }
}

export type { AllocationRow };
