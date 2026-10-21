import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId } from '@cube-track/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsRepository } from '../../work/infrastructure/items.repository.js';
import { resolveApprovalStatus, type ApprovalDecision } from '../domain/approval.js';

const { approvalRequests, approvalApprovers, users } = schema;

export interface ApproverDto {
  userId: string;
  name: string;
  avatarUrl: string | null;
  decision: 'approved' | 'rejected' | null;
  comment: string | null;
  decidedAt: string | null;
}

export interface ApprovalRequestDto {
  id: string;
  itemId: string;
  mode: 'all' | 'any';
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  approvers: ApproverDto[];
  canDecide: boolean;
}

/** Pedidos de aprovação de um item, um ou mais aprovadores, modo "todos"/"qualquer um" (ADR 0048). */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly itemsRepository: ItemsRepository,
    private readonly events: DomainEvents,
  ) {}

  private async itemOrThrow(itemId: string) {
    const item = await this.itemsRepository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    return item;
  }

  async list(user: AuthPrincipal, itemId: string): Promise<ApprovalRequestDto[]> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const requests = await tx
      .select({ request: approvalRequests, requestedByName: users.name })
      .from(approvalRequests)
      .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
      .where(eq(approvalRequests.itemId, itemId))
      .orderBy(asc(approvalRequests.createdAt));
    const result: ApprovalRequestDto[] = [];
    for (const row of requests) {
      const approvers = await this.approversOf(row.request.id);
      result.push({
        id: row.request.id,
        itemId: row.request.itemId,
        mode: row.request.mode,
        note: row.request.note,
        status: row.request.status,
        requestedBy: row.request.requestedBy,
        requestedByName: row.requestedByName,
        createdAt: row.request.createdAt.toISOString(),
        resolvedAt: row.request.resolvedAt?.toISOString() ?? null,
        approvers,
        canDecide: approvers.some((approver) => approver.userId === user.userId && approver.decision === null),
      });
    }
    return result;
  }

  async request(
    user: AuthPrincipal,
    itemId: string,
    input: { approverIds: string[]; mode: 'all' | 'any'; note?: string | null | undefined },
  ): Promise<ApprovalRequestDto> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const approverIds = [...new Set(input.approverIds)];
    if (approverIds.length === 0) {
      throw new ValidationError([
        { path: 'body.approverIds', message: 'Informe pelo menos um aprovador.' },
      ]);
    }
    const tx = this.runner.tx;
    const id = newId();
    await tx.insert(approvalRequests).values({
      id,
      tenantId: user.tenantId,
      boardId: item.boardId,
      itemId,
      requestedBy: user.userId,
      mode: input.mode,
      note: input.note ?? null,
      status: 'pending',
      createdBy: user.userId,
    });
    await tx.insert(approvalApprovers).values(
      approverIds.map((userId) => ({
        id: newId(),
        tenantId: user.tenantId,
        requestId: id,
        userId,
        createdBy: user.userId,
      })),
    );
    this.events.recordChange({
      action: 'approval.request',
      entityType: 'approval_request',
      entityId: id,
      boardId: item.boardId,
      itemId,
      after: { mode: input.mode, approverIds },
      activity: [{ action: 'approval.request', newValue: { mode: input.mode, approverIds } }],
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'approval.changed',
      aggregateType: 'approval_request',
      aggregateId: id,
      boardId: item.boardId,
      itemId,
      payload: { requestId: id, itemId, status: 'pending', requestedBy: user.userId, approverIds },
      actorId: user.userId,
    });
    return this.single(user, id);
  }

  async decide(
    user: AuthPrincipal,
    requestId: string,
    decision: 'approved' | 'rejected',
    comment?: string | null,
  ): Promise<ApprovalRequestDto> {
    const request = await this.requestOrThrow(requestId);
    const item = await this.itemOrThrow(request.itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    if (request.status !== 'pending') {
      throw new ValidationError([
        { path: 'body.decision', message: 'Este pedido de aprovação já foi resolvido.' },
      ]);
    }
    const tx = this.runner.tx;
    const [approver] = await tx
      .select()
      .from(approvalApprovers)
      .where(and(eq(approvalApprovers.requestId, requestId), eq(approvalApprovers.userId, user.userId)));
    if (approver === undefined) {
      throw new ForbiddenError('Você não é um aprovador deste pedido.', 'not_an_approver');
    }
    await tx
      .update(approvalApprovers)
      .set({ decision, comment: comment ?? null, decidedAt: new Date() })
      .where(eq(approvalApprovers.id, approver.id));
    const approvers = await tx
      .select({ decision: approvalApprovers.decision })
      .from(approvalApprovers)
      .where(eq(approvalApprovers.requestId, requestId));
    const decisions: ApprovalDecision[] = approvers.map((row) => row.decision);
    const status = resolveApprovalStatus(request.mode, decisions);
    if (status !== 'pending') {
      await tx
        .update(approvalRequests)
        .set({ status, resolvedAt: new Date() })
        .where(eq(approvalRequests.id, requestId));
    }
    this.events.recordChange({
      action: 'approval.decide',
      entityType: 'approval_request',
      entityId: requestId,
      boardId: item.boardId,
      itemId: request.itemId,
      after: { decision, status },
      activity: [
        {
          action: 'approval.decide',
          newValue: { decision, status, by: user.userId },
        },
      ],
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'approval.changed',
      aggregateType: 'approval_request',
      aggregateId: requestId,
      boardId: item.boardId,
      itemId: request.itemId,
      payload: { requestId, itemId: request.itemId, status, requestedBy: request.requestedBy },
      actorId: user.userId,
    });
    return this.single(user, requestId);
  }

  async cancel(user: AuthPrincipal, requestId: string): Promise<void> {
    const request = await this.requestOrThrow(requestId);
    const item = await this.itemOrThrow(request.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    if (request.status !== 'pending') {
      throw new ValidationError([
        { path: 'body.requestId', message: 'Este pedido de aprovação já foi resolvido.' },
      ]);
    }
    await this.runner.tx
      .update(approvalRequests)
      .set({ status: 'cancelled', resolvedAt: new Date() })
      .where(eq(approvalRequests.id, requestId));
    this.events.recordChange({
      action: 'approval.cancel',
      entityType: 'approval_request',
      entityId: requestId,
      boardId: item.boardId,
      itemId: request.itemId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'approval.changed',
      aggregateType: 'approval_request',
      aggregateId: requestId,
      boardId: item.boardId,
      itemId: request.itemId,
      payload: { requestId, itemId: request.itemId, status: 'cancelled', requestedBy: request.requestedBy },
      actorId: user.userId,
    });
  }

  private async single(user: AuthPrincipal, requestId: string): Promise<ApprovalRequestDto> {
    const request = await this.requestOrThrow(requestId);
    const list = await this.list(user, request.itemId);
    const found = list.find((entry) => entry.id === requestId);
    if (found === undefined) throw new NotFoundError('Pedido de aprovação');
    return found;
  }

  private async requestOrThrow(requestId: string) {
    const [row] = await this.runner.tx
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId));
    if (row === undefined) throw new NotFoundError('Pedido de aprovação');
    return row;
  }

  private async approversOf(requestId: string): Promise<ApproverDto[]> {
    const rows = await this.runner.tx
      .select({
        userId: approvalApprovers.userId,
        name: users.name,
        avatarUrl: users.avatarUrl,
        decision: approvalApprovers.decision,
        comment: approvalApprovers.comment,
        decidedAt: approvalApprovers.decidedAt,
      })
      .from(approvalApprovers)
      .innerJoin(users, eq(users.id, approvalApprovers.userId))
      .where(eq(approvalApprovers.requestId, requestId));
    return rows.map((row) => ({
      ...row,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    }));
  }
}
