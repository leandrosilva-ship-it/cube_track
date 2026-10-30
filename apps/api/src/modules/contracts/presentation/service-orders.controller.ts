import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { ServiceOrderItemsService } from '../application/service-order-items.service.js';
import { ServiceOrdersService } from '../application/service-orders.service.js';
import * as S from './schemas.js';

/** Ordens de Serviço e suas linhas (vínculo item do catálogo × quantidade) — ADR 0054. */
@Controller()
export class ServiceOrdersController {
  constructor(
    private readonly serviceOrders: ServiceOrdersService,
    private readonly items: ServiceOrderItemsService,
  ) {}

  @Get('boards/:boardId/service-orders')
  @Endpoint({
    summary: 'Listar OS de um board',
    tags: ['contracts'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.ServiceOrderSchema) }),
  })
  async listForBoard(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return { data: await this.serviceOrders.listForBoard(user, params.boardId) };
  }

  @Post('boards/:boardId/service-orders')
  @Audited({ action: 'service_order.create', entityType: 'service_order' })
  @Endpoint({
    summary: 'Criar OS avulsa (sem item vinculado) em um board com contrato',
    tags: ['contracts'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateServiceOrderBody,
    response: S.ServiceOrderSchema,
  })
  createForBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateServiceOrderBody>,
  ) {
    return this.serviceOrders.createForBoard(user, params.boardId, body);
  }

  @Get('items/:itemId/service-order')
  @Endpoint({
    summary: 'OS vinculada ao item (ou null)',
    tags: ['contracts'],
    params: S.ItemParams,
    response: S.ServiceOrderSchema.nullable(),
  })
  getForItem(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ItemParams>) {
    return this.serviceOrders.getForItem(user, params.itemId);
  }

  @Post('items/:itemId/service-order')
  @Audited({ action: 'service_order.create', entityType: 'service_order' })
  @Endpoint({
    summary: 'Criar OS vinculada a um item (Painel do Item)',
    tags: ['contracts'],
    status: 201,
    params: S.ItemParams,
    body: S.CreateServiceOrderBody,
    response: S.ServiceOrderSchema,
  })
  createForItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ItemParams>,
    @Input('body') body: z.infer<typeof S.CreateServiceOrderBody>,
  ) {
    return this.serviceOrders.createForItem(user, params.itemId, body);
  }

  @Patch('service-orders/:id')
  @Audited({ action: 'service_order.update', entityType: 'service_order' })
  @Endpoint({
    summary: 'Atualizar dados da OS',
    tags: ['contracts'],
    params: S.ServiceOrderParams,
    body: S.UpdateServiceOrderBody,
    response: S.ServiceOrderSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ServiceOrderParams>,
    @Input('body') body: z.infer<typeof S.UpdateServiceOrderBody>,
  ) {
    return this.serviceOrders.update(user, params.id, body);
  }

  @Post('service-orders/:id/transition')
  @Audited({ action: 'service_order.transition', entityType: 'service_order' })
  @Endpoint({
    summary: 'Transicionar status da OS (solicitada → emitida → em execução → entregue → aceita → medida → faturada; ou cancelar)',
    tags: ['contracts'],
    params: S.ServiceOrderParams,
    body: S.TransitionServiceOrderBody,
    response: S.ServiceOrderSchema,
  })
  transition(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ServiceOrderParams>,
    @Input('body') body: z.infer<typeof S.TransitionServiceOrderBody>,
  ) {
    return this.serviceOrders.transition(user, params.id, body.to);
  }

  @Delete('service-orders/:id')
  @Audited({ action: 'service_order.delete', entityType: 'service_order' })
  @Endpoint({ summary: 'Excluir OS (só em rascunho)', tags: ['contracts'], params: S.ServiceOrderParams })
  remove(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ServiceOrderParams>) {
    return this.serviceOrders.remove(user, params.id);
  }

  // -------------------------------------------------------------------------------------- linhas ---

  @Post('service-orders/:id/items')
  @Audited({ action: 'service_order_item.create', entityType: 'service_order_item' })
  @Endpoint({
    summary: 'Adicionar linha (Código Edital × quantidade) à OS',
    description:
      'Preenche a UST/unidade com o padrão do catálogo; um valor diferente exige `ustOverrideReason`.',
    tags: ['contracts'],
    status: 201,
    params: S.ServiceOrderParams,
    body: S.CreateServiceOrderItemBody,
    response: S.ServiceOrderSchema,
  })
  addItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ServiceOrderParams>,
    @Input('body') body: z.infer<typeof S.CreateServiceOrderItemBody>,
  ) {
    return this.items.create(user, params.id, body);
  }

  @Patch('service-order-items/:id')
  @Audited({ action: 'service_order_item.update', entityType: 'service_order_item' })
  @Endpoint({
    summary: 'Atualizar linha da OS',
    tags: ['contracts'],
    params: S.ServiceOrderItemParams,
    body: S.UpdateServiceOrderItemBody,
    response: S.ServiceOrderSchema,
  })
  updateItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ServiceOrderItemParams>,
    @Input('body') body: z.infer<typeof S.UpdateServiceOrderItemBody>,
  ) {
    return this.items.update(user, params.id, body);
  }

  @Delete('service-order-items/:id')
  @Audited({ action: 'service_order_item.delete', entityType: 'service_order_item' })
  @Endpoint({ summary: 'Remover linha da OS', tags: ['contracts'], params: S.ServiceOrderItemParams, response: S.ServiceOrderSchema })
  removeItem(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ServiceOrderItemParams>) {
    return this.items.remove(user, params.id);
  }
}
