import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { positionBetween } from '@cube-track/shared';
import { asc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { stageGates } = schema;

type StageGateRow = typeof stageGates.$inferSelect;

export interface StageGateDto {
  id: string;
  boardId: string;
  name: string;
  position: string;
  status: StageGateRow['status'];
  dueDate: string | null;
  criteria: { label: string; met: boolean }[];
  decidedBy: string | null;
  decidedAt: string | null;
  notes: string | null;
}

function toDto(row: StageGateRow): StageGateDto {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    position: row.position,
    status: row.status,
    dueDate: row.dueDate,
    criteria: row.criteria,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    notes: row.notes,
  };
}

/** Stage gates (ADR 0053): portões de decisão do ciclo de vida do projeto, com checklist por portão. */
@Injectable()
export class StageGatesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<StageGateDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(stageGates)
      .where(eq(stageGates.boardId, boardId))
      .orderBy(asc(stageGates.position));
    return rows.map(toDto);
  }

  async create(
    user: AuthPrincipal,
    boardId: string,
    input: { name: string; dueDate?: string | null | undefined; criteria?: { label: string; met: boolean }[] | undefined },
  ): Promise<StageGateDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    const [last] = await this.runner.tx
      .select({ position: stageGates.position })
      .from(stageGates)
      .where(eq(stageGates.boardId, boardId))
      .orderBy(asc(stageGates.position));
    const [row] = await this.runner.tx
      .insert(stageGates)
      .values({
        tenantId: user.tenantId,
        boardId,
        name: input.name,
        dueDate: input.dueDate ?? null,
        criteria: input.criteria ?? [],
        position: positionBetween(last?.position ?? null, null),
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar portão.');
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(
    user: AuthPrincipal,
    id: string,
    input: {
      name?: string | undefined;
      dueDate?: string | null | undefined;
      criteria?: { label: string; met: boolean }[] | undefined;
      notes?: string | null | undefined;
    },
  ): Promise<StageGateDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    const [row] = await this.runner.tx
      .update(stageGates)
      .set({
        name: input.name ?? existing.name,
        dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
        criteria: input.criteria ?? existing.criteria,
        notes: input.notes === undefined ? existing.notes : input.notes,
      })
      .where(eq(stageGates.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar portão.');
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async decide(
    user: AuthPrincipal,
    id: string,
    input: { status: 'approved' | 'rejected' | 'skipped'; notes?: string | null | undefined },
  ): Promise<StageGateDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    const [row] = await this.runner.tx
      .update(stageGates)
      .set({
        status: input.status,
        decidedBy: user.userId,
        decidedAt: new Date(),
        notes: input.notes === undefined ? existing.notes : input.notes,
      })
      .where(eq(stageGates.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao decidir portão.');
    this.events.recordChange({
      action: 'stage_gate.decide',
      entityType: 'stage_gate',
      entityId: row.id,
      boardId: row.boardId,
      after: { status: row.status },
    });
    await this.emitChanged(user, row, 'decided');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    await this.runner.tx.delete(stageGates).where(eq(stageGates.id, id));
    await this.emitChanged(user, existing, 'deleted');
  }

  async reorder(user: AuthPrincipal, boardId: string, orderedIds: readonly string[]): Promise<void> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx.select().from(stageGates).where(eq(stageGates.boardId, boardId));
    const byId = new Map(rows.map((row) => [row.id, row]));
    let previous: string | null = null;
    for (const id of orderedIds) {
      const row = byId.get(id);
      if (row === undefined) continue;
      const position = positionBetween(previous, null);
      await this.runner.tx.update(stageGates).set({ position }).where(eq(stageGates.id, id));
      previous = position;
    }
    await this.emitChanged(user, { id: boardId, boardId }, 'updated');
  }

  private async locked(id: string): Promise<StageGateRow> {
    const [row] = await this.runner.tx.select().from(stageGates).where(eq(stageGates.id, id));
    if (row === undefined) throw new NotFoundError('Stage gate');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<StageGateRow, 'id' | 'boardId'>,
    change: 'created' | 'updated' | 'decided' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'stage_gate.changed',
      aggregateType: 'stage_gate',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { gateId: row.id, boardId: row.boardId, change },
      actorId: user.userId,
    });
  }
}

export type { StageGateRow };
