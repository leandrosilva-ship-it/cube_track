import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { Transaction } from './client.js';
import { boards, columnDefinitions, dropdownOptions, statusLabels } from './schema/index.js';

export interface StoredStatusLabel {
  id: string;
  label: string;
  color: string;
  category: 'not_started' | 'in_progress' | 'done' | 'stuck';
  position: string;
}

export interface StoredDropdownOption {
  id: string;
  label: string;
  color: string | null;
  position: string;
}

export interface StoredColumn {
  id: string;
  key: string;
  type: string;
  title: string;
  description: string | null;
  binding: string | null;
  settings: Record<string, unknown>;
  isRequired: boolean;
  requiredWhen: Record<string, unknown> | null;
  defaultValue: Record<string, unknown> | null;
  position: string;
  width: number | null;
  labels: StoredStatusLabel[];
  options: StoredDropdownOption[];
}

export interface StoredBoardDefinition {
  boardId: string;
  workspaceId: string;
  settings: Record<string, unknown>;
  columns: StoredColumn[];
}

/**
 * Definição de um board (colunas ativas com rótulos e opções), base das regras de escrita da API e
 * do recálculo de colunas calculadas no worker.
 */
export async function loadBoardDefinition(
  tx: Transaction,
  boardId: string,
): Promise<StoredBoardDefinition | null> {
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
              and(inArray(dropdownOptions.columnId, columnIds), isNull(dropdownOptions.deletedAt)),
            )
            .orderBy(asc(dropdownOptions.position)),
        ]);
  return {
    boardId: board.id,
    workspaceId: board.workspaceId,
    settings: board.settings,
    columns: columns.map((column) => ({
      ...column,
      labels: labels
        .filter((label) => label.columnId === column.id)
        .map(({ columnId: _columnId, ...label }) => label),
      options: options
        .filter((option) => option.columnId === column.id)
        .map(({ columnId: _columnId, ...option }) => option),
    })),
  };
}
