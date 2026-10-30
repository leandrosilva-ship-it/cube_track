import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { CatalogService } from '../application/catalog.service.js';
import { ContractsService } from '../application/contracts.service.js';
import * as S from './schemas.js';

/** Contratos medidos em UST e catálogo de serviços (Código Edital) — módulo opcional `contracts` (ADR 0054/0017). */
@Controller()
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('workspaces/:workspaceId/contracts')
  @Endpoint({
    summary: 'Listar contratos de um workspace',
    tags: ['contracts'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.ContractSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.WorkspaceParams>) {
    return { data: await this.contracts.list(user, params.workspaceId) };
  }

  @Post('workspaces/:workspaceId/contracts')
  @Audited({ action: 'contract.create', entityType: 'contract' })
  @Endpoint({
    summary: 'Criar contrato',
    description: 'Requer `contract.manage` e o módulo opcional `contracts` ativo no workspace.',
    tags: ['contracts'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateContractBody,
    response: S.ContractSchema,
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateContractBody>,
  ) {
    return this.contracts.create(user, params.workspaceId, body);
  }

  @Get('contracts/:id')
  @Endpoint({ summary: 'Detalhar contrato (saldo e alertas ao vivo)', tags: ['contracts'], params: S.ContractParams, response: S.ContractSchema })
  get(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ContractParams>) {
    return this.contracts.get(user, params.id);
  }

  @Patch('contracts/:id')
  @Audited({ action: 'contract.update', entityType: 'contract' })
  @Endpoint({ summary: 'Atualizar contrato', tags: ['contracts'], params: S.ContractParams, body: S.UpdateContractBody, response: S.ContractSchema })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ContractParams>,
    @Input('body') body: z.infer<typeof S.UpdateContractBody>,
  ) {
    return this.contracts.update(user, params.id, body);
  }

  @Delete('contracts/:id')
  @Audited({ action: 'contract.delete', entityType: 'contract' })
  @Endpoint({ summary: 'Excluir contrato', tags: ['contracts'], params: S.ContractParams })
  remove(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ContractParams>) {
    return this.contracts.remove(user, params.id);
  }

  // ------------------------------------------------------------------------------------ catálogo ---

  @Get('contracts/:id/catalog-items')
  @Endpoint({
    summary: 'Listar catálogo de serviços (Código Edital) do contrato',
    tags: ['contracts'],
    params: S.ContractParams,
    response: z.object({ data: z.array(S.CatalogItemSchema) }),
  })
  async listCatalog(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ContractParams>) {
    return { data: await this.catalog.list(user, params.id) };
  }

  @Post('contracts/:id/catalog-items')
  @Audited({ action: 'service_catalog_item.create', entityType: 'service_catalog_item' })
  @Endpoint({
    summary: 'Criar item de catálogo',
    tags: ['contracts'],
    status: 201,
    params: S.ContractParams,
    body: S.CreateCatalogItemBody,
    response: S.CatalogItemSchema,
  })
  createCatalogItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ContractParams>,
    @Input('body') body: z.infer<typeof S.CreateCatalogItemBody>,
  ) {
    return this.catalog.create(user, params.id, body);
  }

  @Patch('catalog-items/:id')
  @Audited({ action: 'service_catalog_item.update', entityType: 'service_catalog_item' })
  @Endpoint({
    summary: 'Atualizar item de catálogo',
    tags: ['contracts'],
    params: S.CatalogItemParams,
    body: S.UpdateCatalogItemBody,
    response: S.CatalogItemSchema,
  })
  updateCatalogItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.CatalogItemParams>,
    @Input('body') body: z.infer<typeof S.UpdateCatalogItemBody>,
  ) {
    return this.catalog.update(user, params.id, body);
  }

  @Delete('catalog-items/:id')
  @Audited({ action: 'service_catalog_item.delete', entityType: 'service_catalog_item' })
  @Endpoint({ summary: 'Desativar item de catálogo', tags: ['contracts'], params: S.CatalogItemParams })
  removeCatalogItem(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.CatalogItemParams>) {
    return this.catalog.remove(user, params.id);
  }
}
