import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnprocessableError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { slas, pipes, phases, slaTrackers, items } = schema;

type SlaRow = typeof slas.$inferSelect;
type SlaTrackerRow = typeof slaTrackers.$inferSelect;

export interface SlaTrackerDto {
  id: string;
  slaId: string;
  itemId: string;
  status: SlaTrackerRow['status'];
  startedAt: string;
  dueAt: string;
  warningAt: string | null;
}

export interface SlaDto {
  id: string;
  boardId: string;
  pipeId: string | null;
  phaseId: string | null;
  name: string;
  targetMinutes: number;
  warningPercent: number;
  useBusinessTime: boolean;
  workCalendarId: string | null;
  startCondition: Record<string, unknown> | null;
  stopCondition: Record<string, unknown> | null;
  pauseCondition: Record<string, unknown> | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlaInput {
  name: string;
  targetMinutes: number;
  warningPercent?: number | undefined;
  useBusinessTime?: boolean | undefined;
  workCalendarId?: string | null | undefined;
  pipeId?: string | null | undefined;
  phaseId?: string | null | undefined;
  startCondition?: Record<string, unknown> | null | undefined;
  stopCondition?: Record<string, unknown> | null | undefined;
  pauseCondition?: Record<string, unknown> | null | undefined;
  isEnabled?: boolean | undefined;
}

export interface UpdateSlaInput {
  name?: string | undefined;
  targetMinutes?: number | undefined;
  warningPercent?: number | undefined;
  useBusinessTime?: boolean | undefined;
  workCalendarId?: string | null | undefined;
  pipeId?: string | null | undefined;
  phaseId?: string | null | undefined;
  startCondition?: Record<string, unknown> | null | undefined;
  stopCondition?: Record<string, unknown> | null | undefined;
  pauseCondition?: Record<string, unknown> | null | undefined;
  isEnabled?: boolean | undefined;
}

function toDto(row: SlaRow): SlaDto {
  return {
    id: row.id,
    boardId: row.boardId,
    pipeId: row.pipeId,
    phaseId: row.phaseId,
    name: row.name,
    targetMinutes: row.targetMinutes,
    warningPercent: row.warningPercent,
    useBusinessTime: row.useBusinessTime,
    workCalendarId: row.workCalendarId,
    startCondition: row.startCondition,
    stopCondition: row.stopCondition,
    pauseCondition: row.pauseCondition,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Definições de SLA (ADR 0051): por board inteiro, por pipe ou por fase. CRUD exige `process.manage`. */
@Injectable()
export class SlasService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<SlaDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(slas)
      .where(and(eq(slas.boardId, boardId), isNull(slas.deletedAt)))
      .orderBy(asc(slas.name));
    return rows.map(toDto);
  }

  /** Trackers correntes (em execução ou pausados) de SLAs deste board — para o indicador do Kanban. */
  async listTrackers(user: AuthPrincipal, boardId: string): Promise<SlaTrackerDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select({ tracker: slaTrackers })
      .from(slaTrackers)
      .innerJoin(slas, eq(slas.id, slaTrackers.slaId))
      .innerJoin(items, eq(items.id, slaTrackers.itemId))
      .where(
        and(
          eq(slas.boardId, boardId),
          isNull(items.deletedAt),
          isNull(items.archivedAt),
          inArray(slaTrackers.status, ['running', 'paused']),
        ),
      );
    return rows.map(({ tracker }) => ({
      id: tracker.id,
      slaId: tracker.slaId,
      itemId: tracker.itemId,
      status: tracker.status,
      startedAt: tracker.startedAt.toISOString(),
      dueAt: tracker.dueAt.toISOString(),
      warningAt: tracker.warningAt?.toISOString() ?? null,
    }));
  }

  async create(user: AuthPrincipal, boardId: string, input: SlaInput): Promise<SlaDto> {
    await this.access.assert(user, 'process.manage', { type: 'board', id: boardId }, 'Board');
    await this.assertScope(boardId, input.pipeId ?? null, input.phaseId ?? null);
    const [row] = await this.runner.tx
      .insert(slas)
      .values({
        tenantId: user.tenantId,
        boardId,
        pipeId: input.pipeId ?? null,
        phaseId: input.phaseId ?? null,
        name: input.name,
        targetMinutes: input.targetMinutes,
        warningPercent: input.warningPercent ?? 80,
        useBusinessTime: input.useBusinessTime ?? true,
        workCalendarId: input.workCalendarId ?? null,
        startCondition: input.startCondition ?? null,
        stopCondition: input.stopCondition ?? null,
        pauseCondition: input.pauseCondition ?? null,
        isEnabled: input.isEnabled ?? true,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar SLA');
    this.events.recordChange({
      action: 'sla.created',
      entityType: 'sla',
      entityId: row.id,
      boardId,
      after: { name: row.name, targetMinutes: row.targetMinutes },
    });
    await this.emitChanged(user, boardId, 'sla_created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, slaId: string, input: UpdateSlaInput): Promise<SlaDto> {
    const existing = await this.locked(slaId);
    await this.access.assert(
      user,
      'process.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    const pipeId = input.pipeId === undefined ? existing.pipeId : input.pipeId;
    const phaseId = input.phaseId === undefined ? existing.phaseId : input.phaseId;
    if (input.pipeId !== undefined || input.phaseId !== undefined)
      await this.assertScope(existing.boardId, pipeId, phaseId);
    const [row] = await this.runner.tx
      .update(slas)
      .set({
        name: input.name ?? existing.name,
        targetMinutes: input.targetMinutes ?? existing.targetMinutes,
        warningPercent: input.warningPercent ?? existing.warningPercent,
        useBusinessTime: input.useBusinessTime ?? existing.useBusinessTime,
        workCalendarId:
          input.workCalendarId === undefined ? existing.workCalendarId : input.workCalendarId,
        pipeId,
        phaseId,
        startCondition:
          input.startCondition === undefined ? existing.startCondition : input.startCondition,
        stopCondition:
          input.stopCondition === undefined ? existing.stopCondition : input.stopCondition,
        pauseCondition:
          input.pauseCondition === undefined ? existing.pauseCondition : input.pauseCondition,
        isEnabled: input.isEnabled ?? existing.isEnabled,
        updatedAt: new Date(),
      })
      .where(eq(slas.id, slaId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar SLA');
    this.events.recordChange({
      action: 'sla.updated',
      entityType: 'sla',
      entityId: row.id,
      boardId: row.boardId,
      before: { targetMinutes: existing.targetMinutes, isEnabled: existing.isEnabled },
      after: { targetMinutes: row.targetMinutes, isEnabled: row.isEnabled },
    });
    await this.emitChanged(user, row.boardId, 'sla_updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, slaId: string): Promise<void> {
    const existing = await this.locked(slaId);
    await this.access.assert(
      user,
      'process.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    await this.runner.tx.update(slas).set({ deletedAt: new Date() }).where(eq(slas.id, slaId));
    this.events.recordChange({
      action: 'sla.deleted',
      entityType: 'sla',
      entityId: slaId,
      boardId: existing.boardId,
      before: { name: existing.name },
    });
    await this.emitChanged(user, existing.boardId, 'sla_deleted');
  }

  private async assertScope(
    boardId: string,
    pipeId: string | null,
    phaseId: string | null,
  ): Promise<void> {
    if (pipeId !== null) {
      const [pipe] = await this.runner.tx
        .select({ id: pipes.id })
        .from(pipes)
        .where(and(eq(pipes.id, pipeId), eq(pipes.boardId, boardId), isNull(pipes.deletedAt)));
      if (pipe === undefined)
        throw new UnprocessableError('Pipe não pertence a este board.', 'pipe_not_in_board');
    }
    if (phaseId !== null) {
      const [phase] = await this.runner.tx
        .select({ id: phases.id, pipeId: phases.pipeId })
        .from(phases)
        .where(and(eq(phases.id, phaseId), isNull(phases.deletedAt)));
      if (phase === undefined || (pipeId !== null && phase.pipeId !== pipeId))
        throw new UnprocessableError('Fase não pertence a este pipe/board.', 'phase_not_in_scope');
    }
  }

  private async emitChanged(
    user: AuthPrincipal,
    boardId: string,
    change: 'sla_created' | 'sla_updated' | 'sla_deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'process_config.changed',
      aggregateType: 'board',
      aggregateId: boardId,
      boardId,
      payload: { boardId, change },
      actorId: user.userId,
    });
  }

  private async locked(slaId: string): Promise<SlaRow> {
    const [row] = await this.runner.tx
      .select()
      .from(slas)
      .where(and(eq(slas.id, slaId), isNull(slas.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('SLA');
    return row;
  }
}
