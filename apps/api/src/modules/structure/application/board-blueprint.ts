import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  initialPositions,
  newId,
  type BoardTemplate,
  type TemplateColumn,
} from '@cube-track/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';

const { groups, columnDefinitions, statusLabels, dropdownOptions, views, items, boards } = schema;

/** Itens copiados de um board-template (limite para manter a criação rápida). */
const TEMPLATE_ITEMS_LIMIT = 1_000;

/**
 * Estrutura inicial de um board (ADR 0040): a partir de um template embutido (grupos, colunas,
 * rótulos, regras e view) ou copiando um board marcado como template (estrutura e, opcionalmente,
 * itens com valores remapeados para os novos rótulos/opções).
 */
@Injectable()
export class BoardBlueprintWriter {
  constructor(private readonly runner: TransactionRunner) {}

  async fromTemplate(user: AuthPrincipal, boardId: string, template: BoardTemplate): Promise<void> {
    const tx = this.runner.tx;
    const common = { tenantId: user.tenantId, createdBy: user.userId };
    const groupPositions = initialPositions(template.groups.length);
    await tx.insert(groups).values(
      template.groups.map((group, index) => ({
        ...common,
        boardId,
        name: group.name,
        color: group.color,
        position: groupPositions[index] ?? 'a0',
      })),
    );
    const columnPositions = initialPositions(template.columns.length);
    const labelIds = new Map<string, string[]>();
    for (const [index, column] of template.columns.entries()) {
      const columnId = newId();
      await tx.insert(columnDefinitions).values({
        ...common,
        id: columnId,
        boardId,
        key: column.key,
        type: column.type,
        title: column.title,
        description: column.description ?? null,
        settings: column.settings ?? {},
        width: column.width ?? null,
        binding: column.binding ?? null,
        isRequired: column.isRequired ?? false,
        position: columnPositions[index] ?? 'a0',
      });
      labelIds.set(column.key, await this.insertChoices(user, columnId, column));
    }
    // Obrigatoriedade condicional depende dos ids dos rótulos recém-criados.
    for (const column of template.columns) {
      if (column.requiredWhenLabel === undefined) continue;
      const labelId = labelIds.get(column.requiredWhenLabel.columnKey)?.[
        column.requiredWhenLabel.labelIndex
      ];
      if (labelId === undefined) continue;
      await tx
        .update(columnDefinitions)
        .set({
          requiredWhen: {
            op: 'and',
            conditions: [
              { field: column.requiredWhenLabel.columnKey, operator: 'is', value: labelId },
            ],
          },
        })
        .where(and(eq(columnDefinitions.boardId, boardId), eq(columnDefinitions.key, column.key)));
    }
    await tx
      .update(boards)
      .set({ settings: { statusColumnKey: template.statusColumnKey } })
      .where(eq(boards.id, boardId));
    await tx.insert(views).values({
      ...common,
      boardId,
      name: template.viewName,
      type: 'table',
      isDefault: true,
      position: 'a0',
    });
  }

  /** Copia a estrutura (e opcionalmente os itens) de um board-template para o novo board. */
  async fromBoard(
    user: AuthPrincipal,
    boardId: string,
    sourceBoardId: string,
    includeItems: boolean,
  ): Promise<void> {
    const tx = this.runner.tx;
    const common = { tenantId: user.tenantId, createdBy: user.userId };
    const [source] = await tx
      .select({ settings: boards.settings })
      .from(boards)
      .where(and(eq(boards.id, sourceBoardId), isNull(boards.deletedAt)));
    if (source === undefined) throw new NotFoundError('Template');
    await tx.update(boards).set({ settings: source.settings }).where(eq(boards.id, boardId));

    const idMap = new Map<string, string>();
    const sourceGroups = await tx
      .select()
      .from(groups)
      .where(
        and(eq(groups.boardId, sourceBoardId), isNull(groups.deletedAt), isNull(groups.archivedAt)),
      )
      .orderBy(asc(groups.position));
    for (const group of sourceGroups) {
      const id = newId();
      idMap.set(group.id, id);
      await tx.insert(groups).values({
        ...common,
        id,
        boardId,
        name: group.name,
        color: group.color,
        position: group.position,
      });
    }
    const sourceColumns = await tx
      .select()
      .from(columnDefinitions)
      .where(and(eq(columnDefinitions.boardId, sourceBoardId), isNull(columnDefinitions.deletedAt)))
      .orderBy(asc(columnDefinitions.position));
    const columnIds = sourceColumns.map((column) => column.id);
    const [labels, options] =
      columnIds.length === 0
        ? [[], []]
        : await Promise.all([
            tx
              .select()
              .from(statusLabels)
              .where(
                and(inArray(statusLabels.columnId, columnIds), isNull(statusLabels.deletedAt)),
              ),
            tx
              .select()
              .from(dropdownOptions)
              .where(
                and(
                  inArray(dropdownOptions.columnId, columnIds),
                  isNull(dropdownOptions.deletedAt),
                ),
              ),
          ]);
    for (const column of sourceColumns) {
      const id = newId();
      idMap.set(column.id, id);
      for (const label of labels.filter((entry) => entry.columnId === column.id))
        idMap.set(label.id, newId());
      for (const option of options.filter((entry) => entry.columnId === column.id))
        idMap.set(option.id, newId());
    }
    const remapIds = (value: unknown): unknown =>
      JSON.parse(JSON.stringify(value), (_key, entry: unknown) =>
        typeof entry === 'string' ? (idMap.get(entry) ?? entry) : entry,
      ) as unknown;
    for (const column of sourceColumns) {
      await tx.insert(columnDefinitions).values({
        ...common,
        id: idMap.get(column.id),
        boardId,
        key: column.key,
        type: column.type,
        title: column.title,
        description: column.description,
        settings: column.settings,
        binding: column.binding,
        isRequired: column.isRequired,
        requiredWhen:
          column.requiredWhen === null
            ? null
            : (remapIds(column.requiredWhen) as Record<string, unknown>),
        defaultValue:
          column.defaultValue === null
            ? null
            : (remapIds(column.defaultValue) as Record<string, unknown>),
        permissions: column.permissions,
        position: column.position,
        width: column.width,
        isHidden: column.isHidden,
      });
    }
    const copiedLabels = labels.map((label) => ({
      ...common,
      id: idMap.get(label.id),
      columnId: idMap.get(label.columnId) ?? label.columnId,
      label: label.label,
      color: label.color,
      category: label.category,
      position: label.position,
      isDefault: label.isDefault,
    }));
    if (copiedLabels.length > 0) await tx.insert(statusLabels).values(copiedLabels);
    const copiedOptions = options.map((option) => ({
      ...common,
      id: idMap.get(option.id),
      columnId: idMap.get(option.columnId) ?? option.columnId,
      label: option.label,
      color: option.color,
      position: option.position,
    }));
    if (copiedOptions.length > 0) await tx.insert(dropdownOptions).values(copiedOptions);
    const autoKeys = new Set(
      sourceColumns
        .filter((column) => ['auto_id', 'file'].includes(column.type))
        .map((column) => column.key),
    );
    if (includeItems && sourceGroups.length > 0) {
      const rows = await tx
        .select()
        .from(items)
        .where(
          and(eq(items.boardId, sourceBoardId), isNull(items.deletedAt), isNull(items.archivedAt)),
        )
        .orderBy(asc(items.parentItemId), asc(items.position))
        .limit(TEMPLATE_ITEMS_LIMIT);
      for (const item of rows.filter((row) => idMap.has(row.groupId))) idMap.set(item.id, newId());
      // Pais antes dos filhos (parent nulo ordena por último em asc: inserimos em duas passadas).
      const ordered = [
        ...rows.filter((row) => row.parentItemId === null),
        ...rows.filter((row) => row.parentItemId !== null),
      ];
      for (const item of ordered) {
        const groupId = idMap.get(item.groupId);
        const parentItemId = item.parentItemId === null ? null : idMap.get(item.parentItemId);
        if (groupId === undefined || parentItemId === undefined) continue;
        const values = Object.fromEntries(
          Object.entries(item.values).filter(([key]) => !autoKeys.has(key)),
        );
        await tx.insert(items).values({
          ...common,
          id: idMap.get(item.id),
          boardId,
          groupId,
          parentItemId,
          name: item.name,
          position: item.position,
          values: remapIds(values) as Record<string, Record<string, unknown>>,
          plannedStartDate: item.plannedStartDate,
          plannedEndDate: item.plannedEndDate,
          updatedBy: user.userId,
        });
      }
    }
    // Views compartilhadas do template (configurações remapeadas para as novas colunas/rótulos).
    const sourceViews = await tx
      .select()
      .from(views)
      .where(and(eq(views.boardId, sourceBoardId), isNull(views.ownerId), isNull(views.deletedAt)))
      .orderBy(asc(views.position));
    for (const view of sourceViews) {
      await tx.insert(views).values({
        ...common,
        boardId,
        type: view.type,
        name: view.name,
        config: remapIds(view.config) as Record<string, unknown>,
        filters: view.filters === null ? null : (remapIds(view.filters) as Record<string, unknown>),
        sort: view.sort,
        groupBy: view.groupBy === null ? null : (remapIds(view.groupBy) as Record<string, unknown>),
        hiddenColumnKeys: view.hiddenColumnKeys,
        isDefault: view.isDefault,
        position: view.position,
      });
    }
  }

  private async insertChoices(
    user: AuthPrincipal,
    columnId: string,
    column: TemplateColumn,
  ): Promise<string[]> {
    const tx = this.runner.tx;
    const common = { tenantId: user.tenantId, createdBy: user.userId, columnId };
    if (column.labels !== undefined && column.labels.length > 0) {
      const positions = initialPositions(column.labels.length);
      const rows = column.labels.map((label, index) => ({
        ...common,
        id: newId(),
        label: label.label,
        color: label.color,
        category: label.category,
        isDefault: index === 0,
        position: positions[index] ?? 'a0',
      }));
      await tx.insert(statusLabels).values(rows);
      return rows.map((row) => row.id);
    }
    if (column.options !== undefined && column.options.length > 0) {
      const positions = initialPositions(column.options.length);
      await tx.insert(dropdownOptions).values(
        column.options.map((option, index) => ({
          ...common,
          label: option.label,
          color: option.color,
          position: positions[index] ?? 'a0',
        })),
      );
    }
    return [];
  }
}
