import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { assertModuleEnabled } from '../../../core/modules/assert-module-enabled.js';
import { AccessService } from '../../access/application/access.service.js';
import { ContractsService } from './contracts.service.js';

const { boards, items, serviceOrders, serviceOrderItems, serviceCatalogItems, workspaces } = schema;

type ServiceOrderRow = typeof serviceOrders.$inferSelect;
type ServiceOrderStatus = ServiceOrderRow['status'];

export interface ServiceOrderItemDto {
  id: string;
  serviceOrderId: string;
  catalogItemId: string;
  catalogItemCode: string;
  catalogItemName: string;
  quantity: string;
  ustUnit: string;
  ustTotal: string;
  description: string | null;
  ustOverrideReason: string | null;
}

export interface ServiceOrderDto {
  id: string;
  contractId: string;
  boardId: string | null;
  itemId: string | null;
  number: string;
  seiProcess: string | null;
  description: string | null;
  status: ServiceOrderStatus;
  requestedAt: string | null;
  issuedAt: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  deliveredAt: string | null;
  acceptedAt: string | null;
  billedAt: string | null;
  totalUst: string;
  requesterName: string | null;
  items: ServiceOrderItemDto[];
}

export interface CreateServiceOrderInput {
  number: string;
  seiProcess?: string | null | undefined;
  description?: string | null | undefined;
  requesterName?: string | null | undefined;
}

export interface UpdateServiceOrderInput {
  description?: string | null | undefined;
  seiProcess?: string | null | undefined;
  requesterName?: string | null | undefined;
  startDate?: string | null | undefined;
  plannedEndDate?: string | null | undefined;
}

/**
 * Sequência linear (ADR 0054, Prompt 13): solicitada → emitida → em execução → entregue → aceita →
 * medida → faturada. `cancelled` é alcançável de qualquer status não-terminal — `invoiced` é o único
 * terminal de verdade (uma OS já faturada não pode ser cancelada).
 */
const TRANSITION_SEQUENCE: ServiceOrderStatus[] = [
  'draft',
  'requested',
  'issued',
  'in_progress',
  'delivered',
  'accepted',
  'measured',
  'invoiced',
];

function isValidTransition(from: ServiceOrderStatus, to: ServiceOrderStatus): boolean {
  if (to === 'cancelled') return from !== 'invoiced' && from !== 'cancelled';
  if (from === 'cancelled' || from === 'invoiced') return false;
  const fromIndex = TRANSITION_SEQUENCE.indexOf(from);
  const toIndex = TRANSITION_SEQUENCE.indexOf(to);
  return toIndex === fromIndex + 1;
}

/** Timestamp (coluna `date`, YYYY-MM-DD) a gravar automaticamente para certas transições. */
function autoDateFor(to: ServiceOrderStatus, today: string): Partial<typeof serviceOrders.$inferInsert> {
  if (to === 'requested') return { requestedAt: today };
  if (to === 'issued') return { issuedAt: today };
  if (to === 'delivered') return { deliveredAt: today };
  if (to === 'accepted') return { acceptedAt: today };
  if (to === 'invoiced') return { billedAt: today };
  return {};
}

/**
 * Ordens de Serviço (ADR 0054): permissão dupla — `board.manage` do board vinculado OU
 * `contract.manage` do workspace do contrato (mesmo padrão de orçamento board×portfólio do
 * Prompt 12) — sempre depois de confirmar que o módulo `contracts` está ativo no workspace.
 */
@Injectable()
export class ServiceOrdersService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly contracts: ContractsService,
    private readonly events: DomainEvents,
  ) {}

  async listForBoard(user: AuthPrincipal, boardId: string): Promise<ServiceOrderDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(serviceOrders)
      .where(and(eq(serviceOrders.boardId, boardId), isNull(serviceOrders.deletedAt)))
      .orderBy(asc(serviceOrders.number));
    return Promise.all(rows.map((row) => this.toDto(row)));
  }

  async createForBoard(user: AuthPrincipal, boardId: string, input: CreateServiceOrderInput): Promise<ServiceOrderDto> {
    await this.assertManage(user, { boardId });
    const [board] = await this.runner.tx.select({ contractId: boards.contractId }).from(boards).where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    if (board.contractId === null)
      throw new UnprocessableError('O board não está vinculado a um contrato.', 'board_without_contract');
    return this.insert(user, { contractId: board.contractId, boardId, itemId: null }, input);
  }

  async getForItem(user: AuthPrincipal, itemId: string): Promise<ServiceOrderDto | null> {
    const [item] = await this.runner.tx
      .select({ id: items.id, boardId: items.boardId, values: items.values })
      .from(items)
      .where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    await this.access.assert(
      user,
      'item.read',
      { type: 'item', item: { id: item.id, boardId: item.boardId, values: item.values } },
      'Item',
    );
    const [board] = await this.runner.tx.select({ contractId: boards.contractId }).from(boards).where(eq(boards.id, item.boardId));
    if (board?.contractId === null || board === undefined) return null;
    await this.assertModuleOnly(board.contractId);
    const [row] = await this.runner.tx
      .select()
      .from(serviceOrders)
      .where(and(eq(serviceOrders.itemId, itemId), isNull(serviceOrders.deletedAt)));
    if (row === undefined) return null;
    return this.toDto(row);
  }

  async createForItem(user: AuthPrincipal, itemId: string, input: CreateServiceOrderInput): Promise<ServiceOrderDto> {
    const [item] = await this.runner.tx.select({ boardId: items.boardId }).from(items).where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    await this.assertManage(user, { boardId: item.boardId });
    const [board] = await this.runner.tx.select({ contractId: boards.contractId }).from(boards).where(eq(boards.id, item.boardId));
    if (board === undefined) throw new NotFoundError('Board');
    if (board.contractId === null)
      throw new UnprocessableError('O board não está vinculado a um contrato.', 'board_without_contract');
    const [existing] = await this.runner.tx
      .select({ id: serviceOrders.id })
      .from(serviceOrders)
      .where(and(eq(serviceOrders.itemId, itemId), isNull(serviceOrders.deletedAt)));
    if (existing !== undefined) throw new ConflictError('Este item já tem uma OS vinculada.');
    return this.insert(user, { contractId: board.contractId, boardId: item.boardId, itemId }, input);
  }

  private async insert(
    user: AuthPrincipal,
    owner: { contractId: string; boardId: string | null; itemId: string | null },
    input: CreateServiceOrderInput,
  ): Promise<ServiceOrderDto> {
    const [existingNumber] = await this.runner.tx
      .select({ id: serviceOrders.id })
      .from(serviceOrders)
      .where(and(eq(serviceOrders.contractId, owner.contractId), eq(serviceOrders.number, input.number), isNull(serviceOrders.deletedAt)));
    if (existingNumber !== undefined) throw new ConflictError('Já existe uma OS com este número neste contrato.');
    const [row] = await this.runner.tx
      .insert(serviceOrders)
      .values({
        tenantId: user.tenantId,
        contractId: owner.contractId,
        boardId: owner.boardId,
        itemId: owner.itemId,
        number: input.number,
        seiProcess: input.seiProcess ?? null,
        description: input.description ?? null,
        requesterName: input.requesterName ?? null,
        status: 'draft',
        totalUst: '0',
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar OS.');
    await this.emitChanged(user, row, 'created');
    return this.toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateServiceOrderInput): Promise<ServiceOrderDto> {
    const existing = await this.locked(id);
    await this.assertManage(user, existing);
    const [row] = await this.runner.tx
      .update(serviceOrders)
      .set({
        description: input.description === undefined ? existing.description : input.description,
        seiProcess: input.seiProcess === undefined ? existing.seiProcess : input.seiProcess,
        requesterName: input.requesterName === undefined ? existing.requesterName : input.requesterName,
        startDate: input.startDate === undefined ? existing.startDate : input.startDate,
        plannedEndDate: input.plannedEndDate === undefined ? existing.plannedEndDate : input.plannedEndDate,
      })
      .where(eq(serviceOrders.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar OS.');
    await this.emitChanged(user, row, 'updated');
    return this.toDto(row);
  }

  async transition(user: AuthPrincipal, id: string, to: ServiceOrderStatus): Promise<ServiceOrderDto> {
    const existing = await this.locked(id);
    await this.assertManage(user, existing);
    if (!isValidTransition(existing.status, to))
      throw new UnprocessableError(
        `Não é possível mudar o status de "${existing.status}" para "${to}".`,
        'invalid_transition',
      );
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await this.runner.tx
      .update(serviceOrders)
      .set({ status: to, ...autoDateFor(to, today) })
      .where(eq(serviceOrders.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao transicionar OS.');
    await this.emitChanged(user, row, 'updated');
    // `service_order.changed` só chega a quem está na room do board (`FanoutService`, redação por
    // permissão de item/board) — a tela de Contratos (nível workspace, sem board nenhum aberto) nunca
    // a recebe. Uma transição é o único jeito de uma OS entrar/sair de `CONSUMING_ORDER_STATUSES` e
    // mudar o saldo visível ali; emitir `contract.changed` também (sempre tenant-scoped, já consumido
    // por `useContracts`/`apply.ts`) é o que faz o saldo atualizar nessa tela em tempo real.
    await this.emitContractChanged(user, row.contractId);
    return this.toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.assertManage(user, existing);
    if (existing.status !== 'draft')
      throw new UnprocessableError('Só é possível excluir uma OS ainda em rascunho.', 'service_order_not_draft');
    await this.runner.tx.update(serviceOrders).set({ deletedAt: new Date() }).where(eq(serviceOrders.id, id));
    await this.emitChanged(user, existing, 'deleted');
  }

  async locked(id: string): Promise<ServiceOrderRow> {
    const [row] = await this.runner.tx.select().from(serviceOrders).where(eq(serviceOrders.id, id));
    if (row === undefined) throw new NotFoundError('Ordem de Serviço');
    return row;
  }

  /** Recalcula `totalUst` da OS como a soma das linhas — chamado pelo serviço de linhas após cada escrita. */
  async recomputeTotal(id: string): Promise<void> {
    const [sum] = await this.runner.tx
      .select({ total: sql<string>`coalesce(sum(${serviceOrderItems.ustTotal}), 0)` })
      .from(serviceOrderItems)
      .where(eq(serviceOrderItems.serviceOrderId, id));
    await this.runner.tx
      .update(serviceOrders)
      .set({ totalUst: sum?.total ?? '0' })
      .where(eq(serviceOrders.id, id));
  }

  /** `board.manage` do board vinculado, ou `contract.manage` do workspace dono do contrato. */
  async assertManage(user: AuthPrincipal, owner: { boardId: string | null; contractId?: string }): Promise<void> {
    if (owner.boardId !== null) {
      if (await this.access.can(user, 'board.manage', { type: 'board', id: owner.boardId })) {
        const contractId = owner.contractId ?? (await this.contractIdOfBoard(owner.boardId));
        if (contractId !== null) await this.assertModuleOnly(contractId);
        return;
      }
    }
    const contractId = owner.contractId ?? (owner.boardId === null ? null : await this.contractIdOfBoard(owner.boardId));
    if (contractId === null) throw new NotFoundError('Ordem de Serviço');
    await this.contracts.assertManage(user, contractId);
  }

  private async contractIdOfBoard(boardId: string): Promise<string | null> {
    const [board] = await this.runner.tx.select({ contractId: boards.contractId }).from(boards).where(eq(boards.id, boardId));
    return board?.contractId ?? null;
  }

  private async assertModuleOnly(contractId: string): Promise<void> {
    const [contract] = await this.runner.tx
      .select({ workspaceId: schema.contracts.workspaceId })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, contractId));
    if (contract === undefined) return;
    const [workspace] = await this.runner.tx
      .select({ enabledModules: workspaces.enabledModules })
      .from(workspaces)
      .where(eq(workspaces.id, contract.workspaceId));
    if (workspace === undefined) return;
    assertModuleEnabled(workspace.enabledModules, 'contracts');
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<ServiceOrderRow, 'id' | 'contractId' | 'boardId' | 'itemId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'service_order.changed',
      aggregateType: 'service_order',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: { serviceOrderId: row.id, contractId: row.contractId, boardId: row.boardId, itemId: row.itemId, change },
      actorId: user.userId,
    });
  }

  /** `contract.changed` é sempre tenant-scoped (sem `boardId`) — chega a quem está na tela de Contratos. */
  private async emitContractChanged(user: AuthPrincipal, contractId: string): Promise<void> {
    const [contract] = await this.runner.tx
      .select({ workspaceId: schema.contracts.workspaceId })
      .from(schema.contracts)
      .where(eq(schema.contracts.id, contractId));
    if (contract === undefined) return;
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'contract.changed',
      aggregateType: 'contract',
      aggregateId: contractId,
      payload: { contractId, workspaceId: contract.workspaceId, change: 'updated' },
      actorId: user.userId,
    });
  }

  async toDto(row: ServiceOrderRow): Promise<ServiceOrderDto> {
    const lineRows = await this.runner.tx
      .select({
        id: serviceOrderItems.id,
        serviceOrderId: serviceOrderItems.serviceOrderId,
        catalogItemId: serviceOrderItems.catalogItemId,
        catalogItemCode: serviceCatalogItems.code,
        catalogItemName: serviceCatalogItems.name,
        quantity: serviceOrderItems.quantity,
        ustUnit: serviceOrderItems.ustUnit,
        ustTotal: serviceOrderItems.ustTotal,
        description: serviceOrderItems.description,
        ustOverrideReason: serviceOrderItems.ustOverrideReason,
      })
      .from(serviceOrderItems)
      .innerJoin(serviceCatalogItems, eq(serviceCatalogItems.id, serviceOrderItems.catalogItemId))
      .where(eq(serviceOrderItems.serviceOrderId, row.id));
    return {
      id: row.id,
      contractId: row.contractId,
      boardId: row.boardId,
      itemId: row.itemId,
      number: row.number,
      seiProcess: row.seiProcess,
      description: row.description,
      status: row.status,
      requestedAt: row.requestedAt,
      issuedAt: row.issuedAt,
      startDate: row.startDate,
      plannedEndDate: row.plannedEndDate,
      deliveredAt: row.deliveredAt,
      acceptedAt: row.acceptedAt,
      billedAt: row.billedAt,
      totalUst: row.totalUst,
      requesterName: row.requesterName,
      items: lineRows,
    };
  }
}

export type { ServiceOrderRow, ServiceOrderStatus };
