import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import {
  parseRequiredWhen,
  type BoardDefinition,
  type ColumnDefinition,
} from '../domain/board-definition.js';

const { boards, columnDefinitions, statusLabels, dropdownOptions, tenants } = schema;

/** Carrega a definição do board (colunas, rótulos e opções) para as regras de escrita e cálculo. */
@Injectable()
export class BoardDefinitionRepository {
  async load(tx: Transaction, boardId: string): Promise<BoardDefinition | null> {
    const [board] = await tx
      .select({ id: boards.id, workspaceId: boards.workspaceId, settings: boards.settings })
      .from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)));
    if (board === undefined) return null;
    const columns = await tx
      .select({
        id: columnDefinitions.id,
        key: columnDefinitions.key,
        type: columnDefinitions.type,
        title: columnDefinitions.title,
        description: columnDefinitions.description,
        binding: columnDefinitions.binding,
        settings: columnDefinitions.settings,
        isRequired: columnDefinitions.isRequired,
        requiredWhen: columnDefinitions.requiredWhen,
        defaultValue: columnDefinitions.defaultValue,
        position: columnDefinitions.position,
        width: columnDefinitions.width,
      })
      .from(columnDefinitions)
      .where(and(eq(columnDefinitions.boardId, boardId), isNull(columnDefinitions.deletedAt)))
      .orderBy(asc(columnDefinitions.position));
    const columnIds = columns.map((column) => column.id);
    const [labels, options] =
      columnIds.length === 0
        ? [[], []]
        : await Promise.all([
            tx
              .select({
                id: statusLabels.id,
                columnId: statusLabels.columnId,
                label: statusLabels.label,
                color: statusLabels.color,
                category: statusLabels.category,
                position: statusLabels.position,
              })
              .from(statusLabels)
              .where(and(inArray(statusLabels.columnId, columnIds), isNull(statusLabels.deletedAt)))
              .orderBy(asc(statusLabels.position)),
            tx
              .select({
                id: dropdownOptions.id,
                columnId: dropdownOptions.columnId,
                label: dropdownOptions.label,
                color: dropdownOptions.color,
                position: dropdownOptions.position,
              })
              .from(dropdownOptions)
              .where(
                and(
                  inArray(dropdownOptions.columnId, columnIds),
                  isNull(dropdownOptions.deletedAt),
                ),
              )
              .orderBy(asc(dropdownOptions.position)),
          ]);
    return {
      boardId: board.id,
      workspaceId: board.workspaceId,
      settings: board.settings,
      columns: columns.map(
        (column): ColumnDefinition => ({
          ...column,
          requiredWhen: parseRequiredWhen(column.requiredWhen),
          labels: labels
            .filter((label) => label.columnId === column.id)
            .map(({ columnId: _columnId, ...label }) => label),
          options: options
            .filter((option) => option.columnId === column.id)
            .map(({ columnId: _columnId, ...option }) => option),
        }),
      ),
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
