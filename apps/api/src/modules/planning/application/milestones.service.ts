import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { milestones, items } = schema;

export type MilestoneStatus = 'pending' | 'achieved' | 'missed' | 'cancelled';

export interface MilestoneDto {
  id: string;
  boardId: string;
  itemId: string | null;
  name: string;
  description: string | null;
  dueDate: string;
  status: MilestoneStatus;
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMilestoneInput {
  name: string;
  description?: string | null | undefined;
  dueDate: string;
  itemId?: string | null | undefined;
  status?: MilestoneStatus | undefined;
}

export interface UpdateMilestoneInput {
  name?: string | undefined;
  description?: string | null | undefined;
  dueDate?: string | undefined;
  itemId?: string | null | undefined;
  status?: MilestoneStatus | undefined;
}

function toDto(row: typeof milestones.$inferSelect): MilestoneDto {
  return {
    id: row.id,
    boardId: row.boardId,
    itemId: row.itemId,
    name: row.name,
    description: row.description,
    dueDate: row.dueDate,
    status: row.status,
    achievedAt: row.achievedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Marcos do cronograma (ADR 0049): entidades nomeadas, com data-alvo e status, opcionalmente ligadas a um item. */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<MilestoneDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(milestones)
      .where(and(eq(milestones.boardId, boardId), isNull(milestones.deletedAt)))
      .orderBy(asc(milestones.dueDate));
    return rows.map(toDto);
  }

  async create(
    user: AuthPrincipal,
    boardId: string,
    input: CreateMilestoneInput,
  ): Promise<MilestoneDto> {
    await this.access.assert(user, 'schedule.manage', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const itemId = await this.resolveItem(boardId, input.itemId ?? null);
    const status = input.status ?? 'pending';
    const [row] = await tx
      .insert(milestones)
      .values({
        tenantId: user.tenantId,
        boardId,
        itemId,
        name: input.name,
        description: input.description ?? null,
        dueDate: input.dueDate,
        status,
        achievedAt: status === 'achieved' ? new Date() : null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar marco');
    this.events.recordChange({
      action: 'milestone.created',
      entityType: 'milestone',
      entityId: row.id,
      boardId,
      after: { name: row.name, dueDate: row.dueDate, status: row.status },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'milestone.changed',
      aggregateType: 'milestone',
      aggregateId: row.id,
      boardId,
      itemId: row.itemId,
      payload: { milestoneId: row.id, boardId, change: 'created' },
      actorId: user.userId,
    });
    return toDto(row);
  }

  async update(
    user: AuthPrincipal,
    milestoneId: string,
    input: UpdateMilestoneInput,
  ): Promise<MilestoneDto> {
    const existing = await this.locked(milestoneId);
    await this.access.assert(
      user,
      'schedule.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    const tx = this.runner.tx;
    const before = {
      name: existing.name,
      description: existing.description,
      dueDate: existing.dueDate,
      itemId: existing.itemId,
      status: existing.status,
    };
    const itemId =
      input.itemId === undefined
        ? existing.itemId
        : await this.resolveItem(existing.boardId, input.itemId);
    const status = input.status ?? existing.status;
    const achievedAt =
      status === 'achieved'
        ? (existing.status === 'achieved' ? existing.achievedAt : null) ?? new Date()
        : null;
    const [row] = await tx
      .update(milestones)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        dueDate: input.dueDate ?? existing.dueDate,
        itemId,
        status,
        achievedAt,
        updatedAt: new Date(),
      })
      .where(eq(milestones.id, milestoneId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar marco');
    this.events.recordChange({
      action: 'milestone.updated',
      entityType: 'milestone',
      entityId: row.id,
      boardId: row.boardId,
      before,
      after: {
        name: row.name,
        description: row.description,
        dueDate: row.dueDate,
        itemId: row.itemId,
        status: row.status,
      },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'milestone.changed',
      aggregateType: 'milestone',
      aggregateId: row.id,
      boardId: row.boardId,
      itemId: row.itemId,
      payload: { milestoneId: row.id, boardId: row.boardId, change: 'updated' },
      actorId: user.userId,
    });
    return toDto(row);
  }

  async remove(user: AuthPrincipal, milestoneId: string): Promise<void> {
    const existing = await this.locked(milestoneId);
    await this.access.assert(
      user,
      'schedule.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    const tx = this.runner.tx;
    await tx
      .update(milestones)
      .set({ deletedAt: new Date() })
      .where(eq(milestones.id, milestoneId));
    this.events.recordChange({
      action: 'milestone.deleted',
      entityType: 'milestone',
      entityId: milestoneId,
      boardId: existing.boardId,
      before: { name: existing.name },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'milestone.changed',
      aggregateType: 'milestone',
      aggregateId: milestoneId,
      boardId: existing.boardId,
      itemId: existing.itemId,
      payload: { milestoneId, boardId: existing.boardId, change: 'deleted' },
      actorId: user.userId,
    });
  }

  private async locked(milestoneId: string): Promise<typeof milestones.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(milestones)
      .where(and(eq(milestones.id, milestoneId), isNull(milestones.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Marco');
    return row;
  }

  /** Confere que o item (se informado) pertence ao board do marco. */
  private async resolveItem(boardId: string, itemId: string | null): Promise<string | null> {
    if (itemId === null) return null;
    const [row] = await this.runner.tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.boardId, boardId), isNull(items.deletedAt)));
    if (row === undefined)
      throw new ValidationError([{ path: 'body.itemId', message: 'Item fora do board.' }]);
    return row.id;
  }
}
