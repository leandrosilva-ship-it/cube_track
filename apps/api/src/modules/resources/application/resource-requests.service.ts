import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from './workspace-scope.js';

const { boards, resourceRequests, skills, users } = schema;

type RequestRow = typeof resourceRequests.$inferSelect;

export interface ResourceRequestDto {
  id: string;
  boardId: string;
  itemId: string | null;
  skillId: string | null;
  roleTitle: string;
  hours: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'fulfilled' | 'cancelled';
  assignedUserId: string | null;
  notes: string | null;
}

export interface CreateResourceRequestInput {
  boardId: string;
  itemId?: string | null | undefined;
  skillId?: string | null | undefined;
  roleTitle: string;
  hours: string;
  startDate: string;
  endDate: string;
  notes?: string | null | undefined;
}

function toDto(row: RequestRow): ResourceRequestDto {
  return {
    id: row.id,
    boardId: row.boardId,
    itemId: row.itemId,
    skillId: row.skillId,
    roleTitle: row.roleTitle,
    hours: row.hours,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    assignedUserId: row.assignedUserId,
    notes: row.notes,
  };
}

/**
 * Solicitações de recurso (ADR 0052): gestor de projeto pede um perfil/skill; gestor de recursos
 * aprova e aloca uma pessoa (a alocação em si é criada separadamente via `AllocationsService`).
 */
@Injectable()
export class ResourceRequestsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForBoard(user: AuthPrincipal, boardId: string): Promise<ResourceRequestDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(resourceRequests)
      .where(eq(resourceRequests.boardId, boardId));
    return rows.map(toDto);
  }

  /** Lista todas as solicitações abertas do tenant — requer `resources.manage`. */
  async listOpen(user: AuthPrincipal): Promise<ResourceRequestDto[]> {
    await this.assertManage(user);
    const rows = await this.runner.tx
      .select()
      .from(resourceRequests)
      .where(eq(resourceRequests.status, 'open'));
    return rows.map(toDto);
  }

  /** Gestor de projeto (quem pode gerenciar o board) solicita um perfil/skill. */
  async create(user: AuthPrincipal, input: CreateResourceRequestInput): Promise<ResourceRequestDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: input.boardId }, 'Board');
    if (input.endDate < input.startDate)
      throw new ValidationError([{ path: 'body.endDate', message: 'O fim não pode ser antes do início.' }]);
    if (!(Number(input.hours) > 0))
      throw new ValidationError([{ path: 'body.hours', message: 'Horas devem ser maiores que 0.' }]);
    const [board] = await this.runner.tx
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.id, input.boardId));
    if (board === undefined) throw new NotFoundError('Board');
    if (input.skillId !== undefined && input.skillId !== null) {
      const [skill] = await this.runner.tx
        .select({ id: skills.id })
        .from(skills)
        .where(and(eq(skills.id, input.skillId), isNull(skills.deletedAt)));
      if (skill === undefined)
        throw new ValidationError([{ path: 'body.skillId', message: 'Skill não encontrada.' }]);
    }
    const [row] = await this.runner.tx
      .insert(resourceRequests)
      .values({
        tenantId: user.tenantId,
        boardId: input.boardId,
        itemId: input.itemId ?? null,
        skillId: input.skillId ?? null,
        roleTitle: input.roleTitle,
        hours: input.hours,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: input.notes ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar solicitação de recurso.');
    this.events.recordChange({
      action: 'resource_request.create',
      entityType: 'resource_request',
      entityId: row.id,
      boardId: row.boardId,
      after: { roleTitle: row.roleTitle, hours: row.hours },
    });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  /** Gestor de recursos aprova e atribui uma pessoa (status passa a `fulfilled`). */
  async assign(user: AuthPrincipal, id: string, assignedUserId: string): Promise<ResourceRequestDto> {
    await this.assertManage(user);
    const existing = await this.locked(id);
    if (existing.status !== 'open')
      throw new ValidationError([{ path: 'body.status', message: 'Esta solicitação já foi decidida.' }]);
    const [person] = await this.runner.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, assignedUserId));
    if (person === undefined)
      throw new ValidationError([{ path: 'body.assignedUserId', message: 'Usuário não encontrado.' }]);
    const [row] = await this.runner.tx
      .update(resourceRequests)
      .set({ status: 'fulfilled', assignedUserId, updatedAt: new Date() })
      .where(eq(resourceRequests.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atribuir solicitação de recurso.');
    this.events.recordChange({
      action: 'resource_request.assign',
      entityType: 'resource_request',
      entityId: row.id,
      boardId: row.boardId,
      after: { assignedUserId: row.assignedUserId },
    });
    await this.emitChanged(user, row, 'fulfilled');
    return toDto(row);
  }

  async cancel(user: AuthPrincipal, id: string): Promise<ResourceRequestDto> {
    await this.assertManage(user);
    const existing = await this.locked(id);
    if (existing.status !== 'open')
      throw new ValidationError([{ path: 'body.status', message: 'Esta solicitação já foi decidida.' }]);
    const [row] = await this.runner.tx
      .update(resourceRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(resourceRequests.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao cancelar solicitação de recurso.');
    this.events.recordChange({
      action: 'resource_request.cancel',
      entityType: 'resource_request',
      entityId: row.id,
      boardId: row.boardId,
    });
    await this.emitChanged(user, row, 'cancelled');
    return toDto(row);
  }

  private async locked(id: string): Promise<RequestRow> {
    const [row] = await this.runner.tx
      .select()
      .from(resourceRequests)
      .where(eq(resourceRequests.id, id))
      .for('update');
    if (row === undefined) throw new NotFoundError('Solicitação de recurso');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<RequestRow, 'id' | 'boardId'>,
    change: 'created' | 'updated' | 'fulfilled' | 'cancelled',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'resource_request.changed',
      aggregateType: 'resource_request',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { requestId: row.id, boardId: row.boardId, change },
      actorId: user.userId,
    });
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'resources.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
  }
}

export type { RequestRow };
