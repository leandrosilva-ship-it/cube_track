import { Injectable } from '@nestjs/common';
import { loadBoardDefinition, schema, type Transaction } from '@cube-track/db';
import { eq } from 'drizzle-orm';

import { parseRequiredWhen, type BoardDefinition } from '../domain/board-definition.js';

const { tenants } = schema;

/** Carrega a definição do board (colunas, rótulos e opções) para as regras de escrita e cálculo. */
@Injectable()
export class BoardDefinitionRepository {
  async load(tx: Transaction, boardId: string): Promise<BoardDefinition | null> {
    const definition = await loadBoardDefinition(tx, boardId);
    if (definition === null) return null;
    return {
      ...definition,
      columns: definition.columns.map((column) => ({
        ...column,
        requiredWhen: parseRequiredWhen(column.requiredWhen),
      })),
    };
  }

  async tenantTimezone(tx: Transaction, tenantId: string): Promise<string> {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return tenant?.timezone ?? 'America/Sao_Paulo';
  }
}
