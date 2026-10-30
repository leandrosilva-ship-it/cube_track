import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  computeContractBalance,
  evaluateExpiring,
  evaluateLowBalance,
  evaluateStalledOrder,
  type ContractAlert,
  type ContractBalance,
} from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { assertModuleEnabled } from '../../../core/modules/assert-module-enabled.js';
import { AccessService } from '../../access/application/access.service.js';

const { contracts, serviceOrders, workspaces } = schema;

type ContractRow = typeof contracts.$inferSelect;

export interface StalledOrderAlert {
  serviceOrderId: string;
  number: string;
  alert: ContractAlert;
}

export interface ContractDto {
  id: string;
  workspaceId: string;
  number: string;
  title: string;
  clientName: string;
  clientDocument: string | null;
  object: string | null;
  seiProcess: string | null;
  biddingReference: string | null;
  startDate: string;
  endDate: string;
  ustUnitPrice: string;
  ustContracted: string;
  totalValue: string;
  status: ContractRow['status'];
  managerId: string | null;
  notes: string | null;
  balance: ContractBalance;
  alerts: ContractAlert[];
  stalledOrders: StalledOrderAlert[];
}

export interface ContractInput {
  number: string;
  title: string;
  clientName: string;
  clientDocument?: string | null | undefined;
  object?: string | null | undefined;
  seiProcess?: string | null | undefined;
  biddingReference?: string | null | undefined;
  startDate: string;
  endDate: string;
  ustUnitPrice: string;
  ustContracted: string;
  totalValue: string;
  status?: ContractRow['status'] | undefined;
  managerId?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface UpdateContractInput {
  number?: string | undefined;
  title?: string | undefined;
  clientName?: string | undefined;
  clientDocument?: string | null | undefined;
  object?: string | null | undefined;
  seiProcess?: string | null | undefined;
  biddingReference?: string | null | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  ustUnitPrice?: string | undefined;
  ustContracted?: string | undefined;
  totalValue?: string | undefined;
  status?: ContractRow['status'] | undefined;
  managerId?: string | null | undefined;
  notes?: string | null | undefined;
}

/**
 * Contratos (ADR 0054, módulo opcional `contracts` — ADR 0017): o saldo de UST nunca é armazenado,
 * é sempre calculado ao ler a partir das OS atuais (`computeContractBalance`) — é isso que faz
 * "saldo atualizado automaticamente a cada OS aceita" ser verdade por construção, sem motor de
 * recálculo assíncrono.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, workspaceId: string): Promise<ContractDto[]> {
    await this.access.assert(user, 'contract.read', { type: 'workspace', id: workspaceId }, 'Workspace');
    await this.assertEnabled(workspaceId);
    const rows = await this.runner.tx
      .select()
      .from(contracts)
      .where(and(eq(contracts.workspaceId, workspaceId), isNull(contracts.deletedAt)))
      .orderBy(asc(contracts.number));
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async get(user: AuthPrincipal, id: string): Promise<ContractDto> {
    const row = await this.locked(id);
    await this.access.assert(user, 'contract.read', { type: 'workspace', id: row.workspaceId }, 'Workspace');
    await this.assertEnabled(row.workspaceId);
    return this.toDto(row);
  }

  async create(user: AuthPrincipal, workspaceId: string, input: ContractInput): Promise<ContractDto> {
    await this.access.assert(user, 'contract.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
    await this.assertEnabled(workspaceId);
    this.assertValues(input);
    const [row] = await this.runner.tx
      .insert(contracts)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        number: input.number,
        title: input.title,
        clientName: input.clientName,
        clientDocument: input.clientDocument ?? null,
        object: input.object ?? null,
        seiProcess: input.seiProcess ?? null,
        biddingReference: input.biddingReference ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        ustUnitPrice: input.ustUnitPrice,
        ustContracted: input.ustContracted,
        totalValue: input.totalValue,
        status: input.status ?? 'active',
        managerId: input.managerId ?? null,
        notes: input.notes ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar contrato.');
    this.events.recordChange({ action: 'contract.create', entityType: 'contract', entityId: row.id, after: { number: row.number } });
    await this.emitChanged(user, row, 'created');
    return this.toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateContractInput): Promise<ContractDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'contract.manage', { type: 'workspace', id: existing.workspaceId }, 'Workspace');
    await this.assertEnabled(existing.workspaceId);
    const merged: ContractInput = {
      number: input.number ?? existing.number,
      title: input.title ?? existing.title,
      clientName: input.clientName ?? existing.clientName,
      clientDocument: input.clientDocument === undefined ? existing.clientDocument : input.clientDocument,
      object: input.object === undefined ? existing.object : input.object,
      seiProcess: input.seiProcess === undefined ? existing.seiProcess : input.seiProcess,
      biddingReference: input.biddingReference === undefined ? existing.biddingReference : input.biddingReference,
      startDate: input.startDate ?? existing.startDate,
      endDate: input.endDate ?? existing.endDate,
      ustUnitPrice: input.ustUnitPrice ?? existing.ustUnitPrice,
      ustContracted: input.ustContracted ?? existing.ustContracted,
      totalValue: input.totalValue ?? existing.totalValue,
      status: input.status ?? existing.status,
      managerId: input.managerId === undefined ? existing.managerId : input.managerId,
      notes: input.notes === undefined ? existing.notes : input.notes,
    };
    this.assertValues(merged);
    const [row] = await this.runner.tx
      .update(contracts)
      .set({
        number: merged.number,
        title: merged.title,
        clientName: merged.clientName,
        clientDocument: merged.clientDocument ?? null,
        object: merged.object ?? null,
        seiProcess: merged.seiProcess ?? null,
        biddingReference: merged.biddingReference ?? null,
        startDate: merged.startDate,
        endDate: merged.endDate,
        ustUnitPrice: merged.ustUnitPrice,
        ustContracted: merged.ustContracted,
        totalValue: merged.totalValue,
        status: merged.status ?? 'active',
        managerId: merged.managerId ?? null,
        notes: merged.notes ?? null,
      })
      .where(eq(contracts.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar contrato.');
    await this.emitChanged(user, row, 'updated');
    return this.toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'contract.manage', { type: 'workspace', id: existing.workspaceId }, 'Workspace');
    await this.assertEnabled(existing.workspaceId);
    await this.runner.tx.update(contracts).set({ deletedAt: new Date() }).where(eq(contracts.id, id));
    await this.emitChanged(user, existing, 'deleted');
  }

  /** Usado por outros serviços do módulo (catálogo, OS, medição, fatura) para validar o dono. */
  async assertManage(user: AuthPrincipal, contractId: string): Promise<ContractRow> {
    const row = await this.locked(contractId);
    await this.access.assert(user, 'contract.manage', { type: 'workspace', id: row.workspaceId }, 'Workspace');
    await this.assertEnabled(row.workspaceId);
    return row;
  }

  async assertRead(user: AuthPrincipal, contractId: string): Promise<ContractRow> {
    const row = await this.locked(contractId);
    await this.access.assert(user, 'contract.read', { type: 'workspace', id: row.workspaceId }, 'Workspace');
    await this.assertEnabled(row.workspaceId);
    return row;
  }

  async assertMeasure(user: AuthPrincipal, contractId: string): Promise<ContractRow> {
    const row = await this.locked(contractId);
    await this.access.assert(user, 'contract.measure', { type: 'workspace', id: row.workspaceId }, 'Workspace');
    await this.assertEnabled(row.workspaceId);
    return row;
  }

  private async locked(id: string): Promise<ContractRow> {
    const [row] = await this.runner.tx.select().from(contracts).where(eq(contracts.id, id));
    if (row === undefined) throw new NotFoundError('Contrato');
    return row;
  }

  private async assertEnabled(workspaceId: string): Promise<void> {
    const [workspace] = await this.runner.tx
      .select({ enabledModules: workspaces.enabledModules })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (workspace === undefined) throw new NotFoundError('Workspace');
    assertModuleEnabled(workspace.enabledModules, 'contracts');
  }

  private assertValues(input: ContractInput): void {
    if (Number(input.ustUnitPrice) < 0)
      throw new ValidationError([{ path: 'body.ustUnitPrice', message: 'Deve ser maior ou igual a zero.' }]);
    if (Number(input.ustContracted) < 0)
      throw new ValidationError([{ path: 'body.ustContracted', message: 'Deve ser maior ou igual a zero.' }]);
    if (Number(input.totalValue) < 0)
      throw new ValidationError([{ path: 'body.totalValue', message: 'Deve ser maior ou igual a zero.' }]);
    if (input.endDate < input.startDate)
      throw new ValidationError([{ path: 'body.endDate', message: 'O fim não pode ser antes do início.' }]);
  }

  async toDto(row: ContractRow): Promise<ContractDto> {
    const orderRows = await this.runner.tx
      .select({
        id: serviceOrders.id,
        number: serviceOrders.number,
        status: serviceOrders.status,
        totalUst: serviceOrders.totalUst,
        requestedAt: serviceOrders.requestedAt,
      })
      .from(serviceOrders)
      .where(and(eq(serviceOrders.contractId, row.id), isNull(serviceOrders.deletedAt)));
    const balance = computeContractBalance(
      Number(row.ustContracted),
      orderRows.map((order) => ({ status: order.status, totalUst: Number(order.totalUst) })),
    );
    const today = new Date().toISOString().slice(0, 10);
    const alerts: ContractAlert[] = [];
    const lowBalance = evaluateLowBalance(balance);
    if (lowBalance !== null) alerts.push(lowBalance);
    const expiring = evaluateExpiring(row.endDate, today);
    if (expiring !== null) alerts.push(expiring);
    const stalledOrders: StalledOrderAlert[] = [];
    for (const order of orderRows) {
      if (order.status !== 'requested' || order.requestedAt === null) continue;
      const stalled = evaluateStalledOrder(order.requestedAt, today);
      if (stalled !== null) stalledOrders.push({ serviceOrderId: order.id, number: order.number, alert: stalled });
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      number: row.number,
      title: row.title,
      clientName: row.clientName,
      clientDocument: row.clientDocument,
      object: row.object,
      seiProcess: row.seiProcess,
      biddingReference: row.biddingReference,
      startDate: row.startDate,
      endDate: row.endDate,
      ustUnitPrice: row.ustUnitPrice,
      ustContracted: row.ustContracted,
      totalValue: row.totalValue,
      status: row.status,
      managerId: row.managerId,
      notes: row.notes,
      balance,
      alerts,
      stalledOrders,
    };
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<ContractRow, 'id' | 'workspaceId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'contract.changed',
      aggregateType: 'contract',
      aggregateId: row.id,
      payload: { contractId: row.id, workspaceId: row.workspaceId, change },
      actorId: user.userId,
    });
  }
}

export type { ContractRow };
