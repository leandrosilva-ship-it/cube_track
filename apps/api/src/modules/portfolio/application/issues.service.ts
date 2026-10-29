import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { issues } = schema;

type IssueRow = typeof issues.$inferSelect;

export interface IssueDto {
  id: string;
  boardId: string;
  itemId: string | null;
  riskId: string | null;
  title: string;
  description: string | null;
  severity: IssueRow['severity'];
  status: IssueRow['status'];
  ownerId: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface IssueInput {
  title: string;
  description?: string | null | undefined;
  itemId?: string | null | undefined;
  riskId?: string | null | undefined;
  severity?: IssueRow['severity'] | undefined;
  ownerId?: string | null | undefined;
  dueDate?: string | null | undefined;
}

export interface UpdateIssueInput {
  title?: string | undefined;
  description?: string | null | undefined;
  severity?: IssueRow['severity'] | undefined;
  status?: IssueRow['status'] | undefined;
  ownerId?: string | null | undefined;
  dueDate?: string | null | undefined;
  resolution?: string | null | undefined;
}

function toDto(row: IssueRow): IssueDto {
  return {
    id: row.id,
    boardId: row.boardId,
    itemId: row.itemId,
    riskId: row.riskId,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
    resolution: row.resolution,
  };
}

/** Problemas (issues, ADR 0053) — opcionalmente originados de um risco que se concretizou. */
@Injectable()
export class IssuesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<IssueDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(issues)
      .where(and(eq(issues.boardId, boardId), isNull(issues.deletedAt)))
      .orderBy(desc(issues.createdAt));
    return rows.map(toDto);
  }

  async create(user: AuthPrincipal, boardId: string, input: IssueInput): Promise<IssueDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    const [row] = await this.runner.tx
      .insert(issues)
      .values({
        tenantId: user.tenantId,
        boardId,
        itemId: input.itemId ?? null,
        riskId: input.riskId ?? null,
        title: input.title,
        description: input.description ?? null,
        severity: input.severity ?? 'medium',
        ownerId: input.ownerId ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar problema.');
    this.events.recordChange({ action: 'issue.create', entityType: 'issue', entityId: row.id, boardId, after: { title: row.title } });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateIssueInput): Promise<IssueDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    const status = input.status ?? existing.status;
    const resolvingNow = status === 'resolved' && existing.status !== 'resolved';
    const [row] = await this.runner.tx
      .update(issues)
      .set({
        title: input.title ?? existing.title,
        description: input.description === undefined ? existing.description : input.description,
        severity: input.severity ?? existing.severity,
        status,
        ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
        dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
        resolution: input.resolution === undefined ? existing.resolution : input.resolution,
        resolvedAt: resolvingNow ? new Date() : existing.resolvedAt,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar problema.');
    this.events.recordChange({
      action: 'issue.update',
      entityType: 'issue',
      entityId: row.id,
      boardId: row.boardId,
      before: { status: existing.status },
      after: { status: row.status },
    });
    await this.emitChanged(user, row, resolvingNow ? 'resolved' : 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'board.manage', { type: 'board', id: existing.boardId }, 'Board');
    await this.runner.tx.update(issues).set({ deletedAt: new Date() }).where(eq(issues.id, id));
    await this.emitChanged(user, existing, 'deleted');
  }

  private async locked(id: string): Promise<IssueRow> {
    const [row] = await this.runner.tx.select().from(issues).where(eq(issues.id, id));
    if (row === undefined) throw new NotFoundError('Problema');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<IssueRow, 'id' | 'boardId'>,
    change: 'created' | 'updated' | 'resolved' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'issue.changed',
      aggregateType: 'issue',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { issueId: row.id, boardId: row.boardId, change },
      actorId: user.userId,
    });
  }
}

export type { IssueRow };
