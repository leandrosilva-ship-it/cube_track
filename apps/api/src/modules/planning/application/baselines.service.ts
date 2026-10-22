import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { baselines, baselineSnapshots, items } = schema;

export interface BaselineDto {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  capturedAt: string;
  isPrimary: boolean;
}

export interface BaselineComparisonRow {
  itemId: string;
  itemName: string;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  baselineProgress: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  currentProgress: string | null;
}

export interface BaselineDetail extends BaselineDto {
  items: BaselineComparisonRow[];
}

function toDto(row: typeof baselines.$inferSelect): BaselineDto {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    description: row.description,
    capturedAt: row.capturedAt.toISOString(),
    isPrimary: row.isPrimary,
  };
}

/**
 * Baselines do cronograma (ADR 0049): fotografia do board num instante (planejado × realizado).
 * Complementa as colunas nativas replanejado/realizado do item com uma linha de base nomeada e
 * comparável entre si (ex.: "Baseline aprovada – Plano 2026" × estado vigente).
 */
@Injectable()
export class BaselinesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<BaselineDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(baselines)
      .where(and(eq(baselines.boardId, boardId), isNull(baselines.deletedAt)))
      .orderBy(baselines.capturedAt);
    return rows.map(toDto);
  }

  async capture(
    user: AuthPrincipal,
    boardId: string,
    input: { name: string; description?: string | null | undefined },
  ): Promise<BaselineDto> {
    await this.access.assert(user, 'schedule.manage', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const [baseline] = await tx
      .insert(baselines)
      .values({
        tenantId: user.tenantId,
        boardId,
        name: input.name,
        description: input.description ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (baseline === undefined) throw new Error('Falha ao capturar baseline');
    const activeItems = await tx
      .select({
        id: items.id,
        startDate: items.plannedStartDate,
        endDate: items.plannedEndDate,
        progress: items.progress,
      })
      .from(items)
      .where(
        and(eq(items.boardId, boardId), isNull(items.deletedAt), isNull(items.archivedAt)),
      );
    if (activeItems.length > 0) {
      await tx.insert(baselineSnapshots).values(
        activeItems.map((item) => ({
          tenantId: user.tenantId,
          baselineId: baseline.id,
          itemId: item.id,
          startDate: item.startDate,
          endDate: item.endDate,
          progress: item.progress,
        })),
      );
    }
    this.events.recordChange({
      action: 'baseline.captured',
      entityType: 'baseline',
      entityId: baseline.id,
      boardId,
      after: { name: baseline.name, itemCount: activeItems.length },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'baseline.changed',
      aggregateType: 'baseline',
      aggregateId: baseline.id,
      boardId,
      payload: { baselineId: baseline.id, boardId, change: 'captured' },
      actorId: user.userId,
    });
    return toDto(baseline);
  }

  async get(user: AuthPrincipal, baselineId: string): Promise<BaselineDetail> {
    const baseline = await this.find(baselineId);
    await this.access.assert(
      user,
      'board.read',
      { type: 'board', id: baseline.boardId },
      'Board',
    );
    const rows = await this.runner.tx
      .select({
        itemId: items.id,
        itemName: items.name,
        baselineStartDate: baselineSnapshots.startDate,
        baselineEndDate: baselineSnapshots.endDate,
        baselineProgress: baselineSnapshots.progress,
        plannedStartDate: items.plannedStartDate,
        plannedEndDate: items.plannedEndDate,
        replannedStartDate: items.replannedStartDate,
        replannedEndDate: items.replannedEndDate,
        actualStartDate: items.actualStartDate,
        actualEndDate: items.actualEndDate,
        currentProgress: items.progress,
      })
      .from(baselineSnapshots)
      .innerJoin(items, eq(items.id, baselineSnapshots.itemId))
      .where(eq(baselineSnapshots.baselineId, baselineId));
    return { ...toDto(baseline), items: rows };
  }

  async setPrimary(user: AuthPrincipal, baselineId: string): Promise<BaselineDto> {
    const baseline = await this.find(baselineId);
    await this.access.assert(
      user,
      'schedule.manage',
      { type: 'board', id: baseline.boardId },
      'Board',
    );
    const tx = this.runner.tx;
    await tx
      .update(baselines)
      .set({ isPrimary: false })
      .where(and(eq(baselines.boardId, baseline.boardId), eq(baselines.isPrimary, true)));
    const [row] = await tx
      .update(baselines)
      .set({ isPrimary: true })
      .where(eq(baselines.id, baselineId))
      .returning();
    if (row === undefined) throw new Error('Falha ao marcar baseline como primária');
    this.events.recordChange({
      action: 'baseline.primary_changed',
      entityType: 'baseline',
      entityId: row.id,
      boardId: row.boardId,
      after: { isPrimary: true },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'baseline.changed',
      aggregateType: 'baseline',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { baselineId: row.id, boardId: row.boardId, change: 'primary_changed' },
      actorId: user.userId,
    });
    return toDto(row);
  }

  async remove(user: AuthPrincipal, baselineId: string): Promise<void> {
    const baseline = await this.find(baselineId);
    await this.access.assert(
      user,
      'schedule.manage',
      { type: 'board', id: baseline.boardId },
      'Board',
    );
    await this.runner.tx
      .update(baselines)
      .set({ deletedAt: new Date() })
      .where(eq(baselines.id, baselineId));
    this.events.recordChange({
      action: 'baseline.deleted',
      entityType: 'baseline',
      entityId: baselineId,
      boardId: baseline.boardId,
      before: { name: baseline.name },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'baseline.changed',
      aggregateType: 'baseline',
      aggregateId: baselineId,
      boardId: baseline.boardId,
      payload: { baselineId, boardId: baseline.boardId, change: 'deleted' },
      actorId: user.userId,
    });
  }

  private async find(baselineId: string): Promise<typeof baselines.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(baselines)
      .where(and(eq(baselines.id, baselineId), isNull(baselines.deletedAt)));
    if (row === undefined) throw new NotFoundError('Baseline');
    return row;
  }
}
