import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { positionBetween } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { portfolios } = schema;

type PortfolioRow = typeof portfolios.$inferSelect;

export interface PortfolioDto {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  description: string | null;
  ownerId: string | null;
  scoringModelId: string | null;
  status: PortfolioRow['status'];
}

export interface PortfolioInput {
  name: string;
  description?: string | null | undefined;
  folderId?: string | null | undefined;
  ownerId?: string | null | undefined;
  scoringModelId?: string | null | undefined;
  status?: PortfolioRow['status'] | undefined;
}

export interface UpdatePortfolioInput {
  name?: string | undefined;
  description?: string | null | undefined;
  folderId?: string | null | undefined;
  ownerId?: string | null | undefined;
  scoringModelId?: string | null | undefined;
  status?: PortfolioRow['status'] | undefined;
}

function toDto(row: PortfolioRow): PortfolioDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    scoringModelId: row.scoringModelId,
    status: row.status,
  };
}

/** Portfólios (ADR 0053): agrupam programas e projetos (boards) para rollup e priorização. */
@Injectable()
export class PortfoliosService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, workspaceId: string): Promise<PortfolioDto[]> {
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: workspaceId }, 'Workspace');
    const rows = await this.runner.tx
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.workspaceId, workspaceId), isNull(portfolios.deletedAt)))
      .orderBy(asc(portfolios.position));
    return rows.map(toDto);
  }

  async get(user: AuthPrincipal, id: string): Promise<PortfolioDto> {
    const row = await this.locked(id);
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: row.workspaceId }, 'Workspace');
    return toDto(row);
  }

  async create(user: AuthPrincipal, workspaceId: string, input: PortfolioInput): Promise<PortfolioDto> {
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
    const [last] = await this.runner.tx
      .select({ position: portfolios.position })
      .from(portfolios)
      .where(and(eq(portfolios.workspaceId, workspaceId), isNull(portfolios.deletedAt)))
      .orderBy(asc(portfolios.position));
    const [row] = await this.runner.tx
      .insert(portfolios)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        name: input.name,
        description: input.description ?? null,
        folderId: input.folderId ?? null,
        ownerId: input.ownerId ?? null,
        scoringModelId: input.scoringModelId ?? null,
        status: input.status ?? 'active',
        position: positionBetween(last?.position ?? null, null),
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar portfólio.');
    this.events.recordChange({
      action: 'portfolio.create',
      entityType: 'portfolio',
      entityId: row.id,
      after: { name: row.name },
    });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdatePortfolioInput): Promise<PortfolioDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: existing.workspaceId }, 'Workspace');
    const [row] = await this.runner.tx
      .update(portfolios)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        folderId: input.folderId === undefined ? existing.folderId : input.folderId,
        ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
        scoringModelId: input.scoringModelId === undefined ? existing.scoringModelId : input.scoringModelId,
        status: input.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(portfolios.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar portfólio.');
    this.events.recordChange({
      action: 'portfolio.update',
      entityType: 'portfolio',
      entityId: row.id,
      before: { name: existing.name },
      after: { name: row.name },
    });
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: existing.workspaceId }, 'Workspace');
    await this.runner.tx.update(portfolios).set({ deletedAt: new Date() }).where(eq(portfolios.id, id));
    this.events.recordChange({ action: 'portfolio.delete', entityType: 'portfolio', entityId: id });
    await this.emitChanged(user, existing, 'deleted');
  }

  private async locked(id: string): Promise<PortfolioRow> {
    const [row] = await this.runner.tx.select().from(portfolios).where(eq(portfolios.id, id));
    if (row === undefined) throw new NotFoundError('Portfólio');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<PortfolioRow, 'id' | 'workspaceId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'portfolio.changed',
      aggregateType: 'portfolio',
      aggregateId: row.id,
      payload: { portfolioId: row.id, workspaceId: row.workspaceId, change },
      actorId: user.userId,
    });
  }
}

export type { PortfolioRow };
