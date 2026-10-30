import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { computeServiceOrderItemUst, isConsumingOrderStatus } from '@cube-track/shared';
import { eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ServiceOrderDto, ServiceOrderItemDto, ServiceOrdersService } from './service-orders.service.js';

const { serviceCatalogItems, serviceOrderItems } = schema;

type ServiceOrderItemRow = typeof serviceOrderItems.$inferSelect;

export interface CreateServiceOrderItemInput {
  catalogItemId: string;
  quantity: string;
  ustUnit?: string | undefined;
  ustOverrideReason?: string | undefined;
  description?: string | null | undefined;
}

export interface UpdateServiceOrderItemInput {
  quantity?: string | undefined;
  ustUnit?: string | undefined;
  ustOverrideReason?: string | undefined;
  description?: string | null | undefined;
}

/**
 * Linhas da OS (ADR 0054): ao escolher o Código Edital, a UST/unidade é preenchida com o `defaultUst`
 * do catálogo; um `ustUnit` diferente exige `ustOverrideReason` (auditado via `DomainEvents.recordChange`,
 * mesmo mecanismo central de auditoria dos demais módulos). `ustTotal` é sempre recalculado
 * (`computeServiceOrderItemUst`, 4 casas) e o total da OS é a soma das linhas — nunca editável à mão.
 */
@Injectable()
export class ServiceOrderItemsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly serviceOrders: ServiceOrdersService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, serviceOrderId: string): Promise<ServiceOrderItemDto[]> {
    const order = await this.serviceOrders.locked(serviceOrderId);
    await this.serviceOrders.assertManage(user, order);
    const dto = await this.serviceOrders.toDto(order);
    return dto.items;
  }

  async create(
    user: AuthPrincipal,
    serviceOrderId: string,
    input: CreateServiceOrderItemInput,
  ): Promise<ServiceOrderDto> {
    const order = await this.assertEditable(user, serviceOrderId);
    const catalogItem = await this.catalogItemOf(input.catalogItemId, order.contractId);
    const ustUnit = this.resolveUstUnit(catalogItem, input.ustUnit, input.ustOverrideReason);
    const ustTotal = computeServiceOrderItemUst(Number(input.quantity), ustUnit);
    const [row] = await this.runner.tx
      .insert(serviceOrderItems)
      .values({
        tenantId: user.tenantId,
        serviceOrderId,
        catalogItemId: input.catalogItemId,
        quantity: input.quantity,
        ustUnit: ustUnit.toString(),
        ustTotal: ustTotal.toString(),
        description: input.description ?? null,
        ustOverrideReason: input.ustOverrideReason ?? null,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao adicionar linha da OS.');
    this.recordAudit(row, 'create');
    await this.serviceOrders.recomputeTotal(serviceOrderId);
    const updated = await this.serviceOrders.locked(serviceOrderId);
    await this.emitChanged(user, updated, 'updated');
    return this.serviceOrders.toDto(updated);
  }

  async update(
    user: AuthPrincipal,
    id: string,
    input: UpdateServiceOrderItemInput,
  ): Promise<ServiceOrderDto> {
    const existing = await this.locked(id);
    const order = await this.assertEditable(user, existing.serviceOrderId);
    const catalogItem = await this.catalogItemOf(existing.catalogItemId, order.contractId);
    const ustOverrideReason = input.ustOverrideReason ?? existing.ustOverrideReason;
    const ustUnit = this.resolveUstUnit(catalogItem, input.ustUnit ?? existing.ustUnit, ustOverrideReason ?? undefined);
    const quantity = input.quantity ?? existing.quantity;
    const ustTotal = computeServiceOrderItemUst(Number(quantity), ustUnit);
    const [row] = await this.runner.tx
      .update(serviceOrderItems)
      .set({
        quantity,
        ustUnit: ustUnit.toString(),
        ustTotal: ustTotal.toString(),
        description: input.description === undefined ? existing.description : input.description,
        ustOverrideReason,
      })
      .where(eq(serviceOrderItems.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar linha da OS.');
    this.recordAudit(row, 'update', existing);
    await this.serviceOrders.recomputeTotal(existing.serviceOrderId);
    const updated = await this.serviceOrders.locked(existing.serviceOrderId);
    await this.emitChanged(user, updated, 'updated');
    return this.serviceOrders.toDto(updated);
  }

  async remove(user: AuthPrincipal, id: string): Promise<ServiceOrderDto> {
    const existing = await this.locked(id);
    await this.assertEditable(user, existing.serviceOrderId);
    await this.runner.tx.delete(serviceOrderItems).where(eq(serviceOrderItems.id, id));
    this.events.recordChange({
      action: 'service_order_item.delete',
      entityType: 'service_order_item',
      entityId: id,
      before: { catalogItemId: existing.catalogItemId, quantity: existing.quantity, ustUnit: existing.ustUnit },
    });
    await this.serviceOrders.recomputeTotal(existing.serviceOrderId);
    const updated = await this.serviceOrders.locked(existing.serviceOrderId);
    await this.emitChanged(user, updated, 'updated');
    return this.serviceOrders.toDto(updated);
  }

  private async locked(id: string): Promise<ServiceOrderItemRow> {
    const [row] = await this.runner.tx.select().from(serviceOrderItems).where(eq(serviceOrderItems.id, id));
    if (row === undefined) throw new NotFoundError('Linha da Ordem de Serviço');
    return row;
  }

  private async assertEditable(user: AuthPrincipal, serviceOrderId: string) {
    const order = await this.serviceOrders.locked(serviceOrderId);
    await this.serviceOrders.assertManage(user, order);
    if (isConsumingOrderStatus(order.status) || order.status === 'cancelled')
      throw new UnprocessableError(
        'Não é possível alterar linhas de uma OS já aceita, medida, faturada ou cancelada.',
        'service_order_locked',
      );
    return order;
  }

  private async catalogItemOf(catalogItemId: string, contractId: string) {
    const [catalogItem] = await this.runner.tx
      .select()
      .from(serviceCatalogItems)
      .where(eq(serviceCatalogItems.id, catalogItemId));
    if (catalogItem === undefined) throw new NotFoundError('Item de catálogo');
    if (catalogItem.contractId !== contractId)
      throw new UnprocessableError('O item de catálogo não pertence ao contrato desta OS.', 'catalog_item_other_contract');
    return catalogItem;
  }

  /** UST/unidade: `defaultUst` do catálogo, ou um valor manual com justificativa obrigatória. */
  private resolveUstUnit(
    catalogItem: { defaultUst: string },
    ustUnit: string | undefined,
    ustOverrideReason: string | undefined,
  ): number {
    const resolved = ustUnit === undefined ? Number(catalogItem.defaultUst) : Number(ustUnit);
    if (resolved !== Number(catalogItem.defaultUst) && (ustOverrideReason === undefined || ustOverrideReason.trim() === '')) {
      throw new ValidationError([
        {
          path: 'body.ustOverrideReason',
          message: 'Obrigatório justificar o ajuste manual da UST (diferente do padrão do catálogo).',
        },
      ]);
    }
    return resolved;
  }

  private recordAudit(row: ServiceOrderItemRow, action: 'create' | 'update', before?: ServiceOrderItemRow): void {
    this.events.recordChange({
      action: `service_order_item.${action}`,
      entityType: 'service_order_item',
      entityId: row.id,
      before: before === undefined ? undefined : { quantity: before.quantity, ustUnit: before.ustUnit },
      after: { catalogItemId: row.catalogItemId, quantity: row.quantity, ustUnit: row.ustUnit, ustOverrideReason: row.ustOverrideReason },
    });
  }

  private async emitChanged(
    user: AuthPrincipal,
    order: { id: string; contractId: string; boardId: string | null; itemId: string | null },
    change: 'updated',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'service_order.changed',
      aggregateType: 'service_order',
      aggregateId: order.id,
      boardId: order.boardId,
      payload: { serviceOrderId: order.id, contractId: order.contractId, boardId: order.boardId, itemId: order.itemId, change },
      actorId: user.userId,
    });
  }
}
