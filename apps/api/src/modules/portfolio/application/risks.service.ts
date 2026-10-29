import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { risks } = schema;

type RiskRow = typeof risks.$inferSelect;

export interface RiskDto {
  id: string;
  boardId: string;
  itemId: string | null;
  title: string;
  description: string | null;
  category: string | null;
  probability: number;
  impact: number;
  status: RiskRow['status'];
  strategy: RiskRow['strategy'];
  mitigationPlan: string | null;
  contingencyPlan: string | null;
  ownerId: string | null;
  dueDate: string | null;
  closedAt: string | null;
}

export interface RiskInput {
  title: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  itemId?: string | null | undefined;
  probability: number;
  impact: number;
  strategy?: RiskRow['strategy'] | undefined;
  mitigationPlan?: string | null | undefined;
  contingencyPlan?: string | null | undefined;
  ownerId?: string | null | undefined;
  dueDate?: string | null | undefined;
}

export interface UpdateRiskInput {
  title?: string | undefined;
  description?: string | null | undefined;
  category?: string | null | undefined;
  itemId?: string | null | undefined;
  probability?: number | undefined;
  impact?: number | undefined;
  strategy?: RiskRow['strategy'] | undefined;
  mitigationPlan?: string | null | undefined;
  contingencyPlan?: string | null | undefined;
  ownerId?: string | null | undefined;
  dueDate?: string | null | undefined;
  status?: RiskRow['status'] | undefined;
}

function toDto(row: RiskRow): RiskDto {
  return {
    id: row.id,
    boardId: row.boardId,
    itemId: row.itemId,
    title: row.title,
    description: row.description,
    category: row.category,
    probability: row.probability,
    impact: row.impact,
    status: row.status,
    strategy: row.strategy,
    mitigationPlan: row.mitigationPlan,
    contingencyPlan: row.contingencyPlan,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    closedAt: row.closedAt === null ? null : row.closedAt.toISOString(),
  };
}

function assertScale(probability: number, impact: number): void {
  if (probability < 1 || probability > 5) throw new ValidationError([{ path: 'body.probability', message: 'Entre 1 e 5.' }]);
  if (impact < 1 || impact > 5) throw new ValidationError([{ path: 'body.impact', message: 'Entre 1 e 5.' }]);
}

/** Riscos (ADR 0053): matriz probabilidade × impacto (1-5), estratégia e planos de resposta. */
@Injectable()
export class RisksService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<RiskDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(risks)
      .where(and(eq(risks.boardId, boardId), isNull(risks.deletedAt)))
      .orderBy(desc(risks.probability));
    return rows.map(toDto);
  }

  async create(user: AuthPrincipal, boardId: string, input: RiskInput): Promise<RiskDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    assertScale(input.probability, input.impact);
    const [row] = await this.runner.tx
      .insert(risks)
      .values({
        tenantId: user.tenantId,
        boardId,
        itemId: input.itemId ?? null,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        probability: input.probability,
        impact: input.impact,
        strategy: input.strategy ?? null,
        mitigationPlan: input.mitigationPlan ?? null,
        contingencyPlan: input.contingencyPlan ?? null,
        ownerId: input.ownerId ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar risco.');
    this.events.recordChange({ action: 'risk.create', entityType: 'risk', entityId: row.id, boardId, after: { title: row.title } });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateRiskInput): Promise<RiskDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    const probability = input.probability ?? existing.probability;
    const impact = input.impact ?? existing.impact;
    assertScale(probability, impact);
    const status = input.status ?? existing.status;
    const closingNow = status === 'closed' && existing.status !== 'closed';
    const [row] = await this.runner.tx
      .update(risks)
      .set({
        title: input.title ?? existing.title,
        description: input.description === undefined ? existing.description : input.description,
        category: input.category === undefined ? existing.category : input.category,
        probability,
        impact,
        status,
        strategy: input.strategy === undefined ? existing.strategy : input.strategy,
        mitigationPlan: input.mitigationPlan === undefined ? existing.mitigationPlan : input.mitigationPlan,
        contingencyPlan: input.contingencyPlan === undefined ? existing.contingencyPlan : input.contingencyPlan,
        ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
        dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
        closedAt: closingNow ? new Date() : existing.closedAt,
        updatedAt: new Date(),
      })
      .where(eq(risks.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar risco.');
    this.events.recordChange({
      action: 'risk.update',
      entityType: 'risk',
      entityId: row.id,
      boardId: row.boardId,
      before: { status: existing.status },
      after: { status: row.status },
    });
    await this.emitChanged(user, row, closingNow ? 'closed' : 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    await this.runner.tx.update(risks).set({ deletedAt: new Date() }).where(eq(risks.id, id));
    await this.emitChanged(user, existing, 'deleted');
  }

  private async locked(id: string): Promise<RiskRow> {
    const [row] = await this.runner.tx.select().from(risks).where(eq(risks.id, id));
    if (row === undefined) throw new NotFoundError('Risco');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<RiskRow, 'id' | 'boardId'>,
    change: 'created' | 'updated' | 'closed' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'risk.changed',
      aggregateType: 'risk',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { riskId: row.id, boardId: row.boardId, change },
      actorId: user.userId,
    });
  }
}

export type { RiskRow };
