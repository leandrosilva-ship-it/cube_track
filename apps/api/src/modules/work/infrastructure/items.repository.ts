import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';

import type { ItemRecord } from '../domain/item.js';

const { items, groups, statusLabels, dropdownOptions, memberships, teams } = schema;

const itemColumns = {
  id: items.id,
  tenantId: items.tenantId,
  boardId: items.boardId,
  groupId: items.groupId,
  parentItemId: items.parentItemId,
  name: items.name,
  position: items.position,
  phaseId: items.phaseId,
  phaseEnteredAt: items.phaseEnteredAt,
  values: items.values,
  fieldVersions: items.fieldVersions,
  version: items.version,
  descriptionText: items.descriptionText,
  plannedStartDate: items.plannedStartDate,
  plannedEndDate: items.plannedEndDate,
  replannedStartDate: items.replannedStartDate,
  replannedEndDate: items.replannedEndDate,
  actualStartDate: items.actualStartDate,
  actualEndDate: items.actualEndDate,
  progress: items.progress,
  isMilestone: items.isMilestone,
  scheduleMode: items.scheduleMode,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
  createdBy: items.createdBy,
  updatedBy: items.updatedBy,
  completedAt: items.completedAt,
  archivedAt: items.archivedAt,
};

/** Converte uma linha crua (consulta de listagem) para `ItemRecord`. */
export function rowToItem(row: Record<string, unknown>): ItemRecord {
  const date = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    boardId: String(row.board_id),
    groupId: String(row.group_id),
    parentItemId: typeof row.parent_item_id === 'string' ? row.parent_item_id : null,
    name: String(row.name),
    position: String(row.position),
    phaseId: typeof row.phase_id === 'string' ? row.phase_id : null,
    phaseEnteredAt:
      row.phase_entered_at === null || row.phase_entered_at === undefined
        ? null
        : new Date(row.phase_entered_at as string),
    values: row.values as ItemRecord['values'],
    fieldVersions: row.field_versions as ItemRecord['fieldVersions'],
    version: Number(row.version),
    descriptionText: typeof row.description_text === 'string' ? row.description_text : null,
    plannedStartDate: date(row.planned_start_date),
    plannedEndDate: date(row.planned_end_date),
    replannedStartDate: date(row.replanned_start_date),
    replannedEndDate: date(row.replanned_end_date),
    actualStartDate: date(row.actual_start_date),
    actualEndDate: date(row.actual_end_date),
    progress: date(row.progress),
    isMilestone: row.is_milestone === true,
    scheduleMode: row.schedule_mode === 'manual' ? 'manual' : 'auto',
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
    completedAt:
      row.completed_at === null || row.completed_at === undefined
        ? null
        : new Date(row.completed_at as string),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at as string),
  };
}

@Injectable()
export class ItemsRepository {
  async findById(tx: Transaction, itemId: string, forUpdate = false): Promise<ItemRecord | null> {
    const query = tx
      .select(itemColumns)
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
    const [row] = forUpdate ? await query.for('update') : await query;
    return row ?? null;
  }

  async findGroup(tx: Transaction, groupId: string) {
    const [row] = await tx
      .select({ id: groups.id, boardId: groups.boardId })
      .from(groups)
      .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)));
    return row ?? null;
  }

  /** Posições vizinhas para inserir no fim do grupo ou entre dois itens. */
  async lastPosition(
    tx: Transaction,
    groupId: string,
    parentItemId: string | null,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ position: items.position })
      .from(items)
      .where(
        and(
          eq(items.groupId, groupId),
          parentItemId === null ? isNull(items.parentItemId) : eq(items.parentItemId, parentItemId),
          isNull(items.deletedAt),
        ),
      )
      .orderBy(desc(items.position))
      .limit(1);
    return row?.position ?? null;
  }

  async neighborAfter(
    tx: Transaction,
    groupId: string,
    position: string,
    parentItemId: string | null = null,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ position: items.position })
      .from(items)
      .where(
        and(
          eq(items.groupId, groupId),
          gt(items.position, position),
          isNull(items.deletedAt),
          parentItemId === null ? isNull(items.parentItemId) : eq(items.parentItemId, parentItemId),
        ),
      )
      .orderBy(asc(items.position))
      .limit(1);
    return row?.position ?? null;
  }

  async neighborBefore(
    tx: Transaction,
    groupId: string,
    position: string,
    parentItemId: string | null = null,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ position: items.position })
      .from(items)
      .where(
        and(
          eq(items.groupId, groupId),
          lt(items.position, position),
          isNull(items.deletedAt),
          parentItemId === null ? isNull(items.parentItemId) : eq(items.parentItemId, parentItemId),
        ),
      )
      .orderBy(desc(items.position))
      .limit(1);
    return row?.position ?? null;
  }

  async insert(tx: Transaction, values: typeof items.$inferInsert): Promise<ItemRecord> {
    const [row] = await tx.insert(items).values(values).returning(itemColumns);
    if (row === undefined) throw new Error('Falha ao inserir item');
    return row;
  }

  async update(
    tx: Transaction,
    itemId: string,
    values: Partial<typeof items.$inferInsert>,
  ): Promise<ItemRecord> {
    const [row] = await tx
      .update(items)
      .set(values)
      .where(eq(items.id, itemId))
      .returning(itemColumns);
    if (row === undefined) throw new Error('Falha ao atualizar item');
    return row;
  }

  async labelIds(tx: Transaction, columnId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ id: statusLabels.id })
      .from(statusLabels)
      .where(and(eq(statusLabels.columnId, columnId), isNull(statusLabels.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  async optionIds(tx: Transaction, columnId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ id: dropdownOptions.id })
      .from(dropdownOptions)
      .where(and(eq(dropdownOptions.columnId, columnId), isNull(dropdownOptions.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  async existingMembers(tx: Transaction, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(inArray(memberships.userId, userIds), isNull(memberships.deletedAt)));
    return new Set(rows.map((row) => row.userId));
  }

  async existingTeams(tx: Transaction, teamIds: string[]): Promise<Set<string>> {
    if (teamIds.length === 0) return new Set();
    const rows = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(and(inArray(teams.id, teamIds), isNull(teams.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  async existingItems(tx: Transaction, itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(inArray(items.id, itemIds), isNull(items.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  /** Itens existentes entre `itemIds` que pertencem a um dos boards (qualquer board se vazio). */
  async itemsOnBoards(
    tx: Transaction,
    itemIds: string[],
    boardIds: string[],
  ): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          inArray(items.id, itemIds),
          isNull(items.deletedAt),
          boardIds.length === 0 ? undefined : inArray(items.boardId, boardIds),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  /** Item mesmo na lixeira (restauração). */
  async findAny(
    tx: Transaction,
    itemId: string,
  ): Promise<(ItemRecord & { deletedAt: Date | null }) | null> {
    const [row] = await tx
      .select({ ...itemColumns, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, itemId))
      .for('update');
    return row ?? null;
  }

  /** Subitens ativos (ou excluídos no mesmo instante, para restaurar juntos). */
  async children(
    tx: Transaction,
    parentId: string,
    deletedAt: Date | null = null,
  ): Promise<ItemRecord[]> {
    return tx
      .select(itemColumns)
      .from(items)
      .where(
        and(
          eq(items.parentItemId, parentId),
          deletedAt === null ? isNull(items.deletedAt) : eq(items.deletedAt, deletedAt),
        ),
      )
      .orderBy(asc(items.position));
  }

  async updateMany(
    tx: Transaction,
    itemIds: string[],
    values: Partial<typeof items.$inferInsert>,
  ): Promise<void> {
    if (itemIds.length === 0) return;
    await tx.update(items).set(values).where(inArray(items.id, itemIds));
  }

  async runList(
    tx: Transaction,
    query: ReturnType<typeof sql>,
  ): Promise<Record<string, unknown>[]> {
    const result = await tx.execute(query);
    return result.rows;
  }
}
