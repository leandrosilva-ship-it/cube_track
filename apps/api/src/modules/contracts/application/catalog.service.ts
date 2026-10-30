import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, asc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ContractsService } from './contracts.service.js';

const { serviceCatalogItems } = schema;

type CatalogItemRow = typeof serviceCatalogItems.$inferSelect;

export interface CatalogItemDto {
  id: string;
  contractId: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  defaultUst: string;
  unit: string;
  isActive: boolean;
  sortOrder: number;
}

export interface CatalogItemInput {
  code: string;
  name: string;
  description?: string | null | undefined;
  category?: string | null | undefined;
  defaultUst: string;
  unit?: string | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface UpdateCatalogItemInput {
  name?: string | undefined;
  description?: string | null | undefined;
  category?: string | null | undefined;
  defaultUst?: string | undefined;
  unit?: string | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

function toDto(row: CatalogItemRow): CatalogItemDto {
  return {
    id: row.id,
    contractId: row.contractId,
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    defaultUst: row.defaultUst,
    unit: row.unit,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/** Catálogo de serviços (Código Edital) de um contrato — ADR 0054. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly contracts: ContractsService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, contractId: string): Promise<CatalogItemDto[]> {
    await this.contracts.assertRead(user, contractId);
    const rows = await this.runner.tx
      .select()
      .from(serviceCatalogItems)
      .where(eq(serviceCatalogItems.contractId, contractId))
      .orderBy(asc(serviceCatalogItems.sortOrder), asc(serviceCatalogItems.code));
    return rows.map(toDto);
  }

  async create(user: AuthPrincipal, contractId: string, input: CatalogItemInput): Promise<CatalogItemDto> {
    await this.contracts.assertManage(user, contractId);
    if (Number(input.defaultUst) < 0)
      throw new ValidationError([{ path: 'body.defaultUst', message: 'Deve ser maior ou igual a zero.' }]);
    const [existing] = await this.runner.tx
      .select({ id: serviceCatalogItems.id })
      .from(serviceCatalogItems)
      .where(and(eq(serviceCatalogItems.contractId, contractId), eq(serviceCatalogItems.code, input.code)));
    if (existing !== undefined) throw new ConflictError('Já existe um item de catálogo com este código neste contrato.');
    const [row] = await this.runner.tx
      .insert(serviceCatalogItems)
      .values({
        tenantId: user.tenantId,
        contractId,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        defaultUst: input.defaultUst,
        unit: input.unit ?? 'serviço',
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar item de catálogo.');
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateCatalogItemInput): Promise<CatalogItemDto> {
    const existing = await this.locked(id);
    await this.contracts.assertManage(user, existing.contractId);
    if (input.defaultUst !== undefined && Number(input.defaultUst) < 0)
      throw new ValidationError([{ path: 'body.defaultUst', message: 'Deve ser maior ou igual a zero.' }]);
    const [row] = await this.runner.tx
      .update(serviceCatalogItems)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        category: input.category === undefined ? existing.category : input.category,
        defaultUst: input.defaultUst ?? existing.defaultUst,
        unit: input.unit ?? existing.unit,
        isActive: input.isActive ?? existing.isActive,
        sortOrder: input.sortOrder ?? existing.sortOrder,
      })
      .where(eq(serviceCatalogItems.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar item de catálogo.');
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  /**
   * "Excluir" um item de catálogo desativa (`isActive: false`), nunca apaga a linha: não há
   * `deletedAt` neste schema, e uma OS já lançada referencia o item por FK `restrict` — apagar
   * quebraria o histórico de OS existentes. Emite `change: 'updated'` (a linha continua existindo).
   */
  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.contracts.assertManage(user, existing.contractId);
    const [row] = await this.runner.tx
      .update(serviceCatalogItems)
      .set({ isActive: false })
      .where(eq(serviceCatalogItems.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao desativar item de catálogo.');
    await this.emitChanged(user, row, 'updated');
  }

  private async locked(id: string): Promise<CatalogItemRow> {
    const [row] = await this.runner.tx.select().from(serviceCatalogItems).where(eq(serviceCatalogItems.id, id));
    if (row === undefined) throw new NotFoundError('Item de catálogo');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<CatalogItemRow, 'id' | 'contractId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'service_catalog_item.changed',
      aggregateType: 'service_catalog_item',
      aggregateId: row.id,
      payload: { catalogItemId: row.id, contractId: row.contractId, change },
      actorId: user.userId,
    });
  }
}
