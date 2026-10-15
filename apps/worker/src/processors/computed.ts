import {
  loadBoardDefinition,
  loadWorkingCalendar,
  schema,
  type DatabaseHandle,
  type StoredBoardDefinition,
  type StoredColumn,
  type Transaction,
} from '@cube-track/db';
import {
  aggregateValues,
  computeItemColumns,
  ComputedJobSchema,
  DEFAULT_CALENDAR,
  DomainEventJobSchema,
  MIRROR_AGGREGATES,
  ROLLUP_AGGREGATES,
  shiftDays,
  sourceValue,
  type ComputeContext,
  type ComputedColumn,
  type ComputedItem,
  type ComputedJob,
  type ComputedValue,
  type ItemFieldChange,
  type MirrorAggregate,
  type RollupAggregate,
} from '@cube-track/shared';
import type { Job, Queue } from 'bullmq';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { runAsSystem } from '../system-tx.js';

const { items, columnDefinitions, tenants } = schema;

/** Cadeias de recálculo (espelho de espelho…) param nesta profundidade (proteção contra laços). */
export const MAX_COMPUTED_DEPTH = 5;
/** Itens dependentes recalculados por evento. */
const MAX_DEPENDENTS = 2_000;
/** Lote de itens no recálculo do board inteiro. */
const BOARD_BATCH = 500;

const CROSS_TYPES = new Set(['mirror', 'rollup']);

type ItemRow = typeof items.$inferSelect;

/** Colunas que precisam do worker: espelho, rollup e progresso por subitens. */
export function crossItemColumns(definition: StoredBoardDefinition): StoredColumn[] {
  return definition.columns.filter(
    (column) =>
      CROSS_TYPES.has(column.type) ||
      (column.type === 'progress' && column.settings.mode === 'subitems'),
  );
}

function hasComputed(definition: StoredBoardDefinition): boolean {
  return definition.columns.some((column) =>
    ['formula', 'progress', 'mirror', 'rollup'].includes(column.type),
  );
}

function toComputedColumn(column: StoredColumn): ComputedColumn {
  return {
    key: column.key,
    type: column.type,
    title: column.title,
    binding: column.binding,
    settings: column.settings,
    labels: column.labels,
    options: column.options,
  };
}

export function toComputedItem(row: ItemRow): ComputedItem {
  return {
    id: row.id,
    name: row.name,
    values: row.values,
    fields: {
      planned_start_date: row.plannedStartDate,
      planned_end_date: row.plannedEndDate,
      replanned_start_date: row.replannedStartDate,
      replanned_end_date: row.replannedEndDate,
      actual_start_date: row.actualStartDate,
      actual_end_date: row.actualEndDate,
      progress: row.progress,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Coluna de status principal (mesma regra da API). */
function mainStatus(definition: StoredBoardDefinition): StoredColumn | undefined {
  const statuses = definition.columns.filter((column) => column.type === 'status');
  return (
    statuses.find((column) => column.key === definition.settings.statusColumnKey) ??
    statuses.find((column) => column.key === 'c_status') ??
    statuses[0]
  );
}

interface CrossSources {
  /** Subitens do item (rollup/progresso por subitens). */
  subitems: ComputedItem[];
  /** Itens relacionados por id e a definição do board de cada um. */
  related: Map<string, { item: ComputedItem; definition: StoredBoardDefinition }>;
}

/**
 * Calcula os valores de espelho, rollup e progresso por subitens de um item (puro). Devolve só as
 * chaves cujo valor mudou.
 */
export function computeCrossColumns(
  definition: StoredBoardDefinition,
  item: ComputedItem,
  sources: CrossSources,
  now: string,
): Map<string, ComputedValue | null> {
  const changes = new Map<string, ComputedValue | null>();
  const byKey = new Map(definition.columns.map((column) => [column.key, column]));
  for (const column of crossItemColumns(definition)) {
    let next: ComputedValue | null = null;
    if (column.type === 'progress') {
      const keys = Array.isArray(column.settings.sourceColumnKeys)
        ? (column.settings.sourceColumnKeys as string[])
        : [];
      const status =
        (keys[0] === undefined ? undefined : byKey.get(keys[0])) ?? mainStatus(definition);
      next =
        status === undefined
          ? null
          : aggregateValues(
              'done_percent',
              sources.subitems.map((sub) => sourceValue(toComputedColumn(status), sub, undefined)),
              now,
            );
    } else if (column.type === 'rollup' && column.settings.source === 'subitems') {
      const target = byKey.get(String(column.settings.targetColumnKey));
      const aggregate = column.settings.aggregate as RollupAggregate;
      next =
        target === undefined || !ROLLUP_AGGREGATES.includes(aggregate)
          ? null
          : aggregateValues(
              aggregate,
              sources.subitems.map((sub) => sourceValue(toComputedColumn(target), sub, undefined)),
              now,
            );
    } else {
      const relationKey = String(column.settings.relationColumnKey);
      const ids = (item.values[relationKey] as { itemIds?: unknown } | undefined)?.itemIds;
      const relatedIds = Array.isArray(ids) ? ids.map(String) : [];
      const aggregate = (column.settings.aggregate ??
        (column.type === 'mirror' ? 'list' : 'sum')) as RollupAggregate | MirrorAggregate;
      const valid =
        column.type === 'mirror'
          ? (MIRROR_AGGREGATES as readonly string[]).includes(aggregate)
          : (ROLLUP_AGGREGATES as readonly string[]).includes(aggregate);
      const values = relatedIds.flatMap((id) => {
        const entry = sources.related.get(id);
        if (entry === undefined) return [];
        const target = entry.definition.columns.find(
          (candidate) => candidate.key === column.settings.targetColumnKey,
        );
        return target === undefined
          ? [null]
          : [sourceValue(toComputedColumn(target), entry.item, undefined)];
      });
      next = valid ? aggregateValues(aggregate, values, now) : null;
    }
    const previous = item.values[column.key] as ComputedValue | undefined;
    const same =
      (previous === undefined && next === null) ||
      (previous !== undefined &&
        next !== null &&
        previous.n === next.n &&
        previous.d === next.d &&
        previous.text === next.text &&
        previous.error === next.error);
    if (!same) changes.set(column.key, next);
  }
  return changes;
}

/** Converte o job recebido (evento de domínio ou pedido explícito) em pedidos de recálculo. */
export function toComputedJobs(raw: unknown): ComputedJob[] {
  const event = DomainEventJobSchema.safeParse(raw);
  if (!event.success) return [ComputedJobSchema.parse(raw)];
  const { type, tenantId, boardId, itemId, eventId, depth } = event.data;
  if (boardId === null || depth >= MAX_COMPUTED_DEPTH) return [];
  if (type === 'column.created' || type === 'column.updated')
    return [{ tenantId, boardId, itemIds: [], volatileOnly: false, causationId: eventId, depth }];
  if (itemId === null) return [];
  return [
    { tenantId, boardId, itemIds: [itemId], volatileOnly: false, causationId: eventId, depth },
  ];
}

interface ComputedDeps {
  database: DatabaseHandle;
  redis: Redis;
}

export function computedProcessor(deps: ComputedDeps) {
  return async (job: Job<unknown>) => {
    for (const request of toComputedJobs(job.data)) await runComputed(deps, request);
  };
}

/**
 * Executa um pedido: board inteiro (coluna criada/alterada ou fórmulas voláteis) ou os
 * dependentes de itens alterados (pai com rollup de subitens e itens que se relacionam com eles).
 */
export async function runComputed(deps: ComputedDeps, request: ComputedJob): Promise<number> {
  const actor = {
    kind: 'system' as const,
    causationId: request.causationId,
    depth: request.depth + 1,
    correlationId: `computed:${request.causationId ?? request.boardId}`,
  };
  if (request.itemIds.length === 0) {
    let updated = 0;
    let after: string | null = null;
    for (;;) {
      const cursor: string | null = after;
      const batch: { ids: string[]; changed: number } = await runAsSystem(
        deps.database,
        deps.redis,
        request.tenantId,
        actor,
        async (unit): Promise<{ ids: string[]; changed: number }> => {
          const rows: { id: string }[] = await unit.tx
            .select({ id: items.id })
            .from(items)
            .where(
              and(
                eq(items.boardId, request.boardId),
                isNull(items.deletedAt),
                cursor === null ? undefined : gt(items.id, cursor),
              ),
            )
            .orderBy(asc(items.id))
            .limit(BOARD_BATCH);
          const changed = await recomputeItems(
            unit,
            request.tenantId,
            request.boardId,
            rows.map((row) => row.id),
            request.volatileOnly,
          );
          return { ids: rows.map((row) => row.id), changed };
        },
      );
      updated += batch.changed;
      const last = batch.ids.at(-1);
      if (batch.ids.length < BOARD_BATCH || last === undefined) break;
      after = last;
    }
    return updated;
  }
  return runAsSystem(deps.database, deps.redis, request.tenantId, actor, async (unit) => {
    const targets = await dependentsOf(unit.tx, request.boardId, request.itemIds);
    let changed = 0;
    for (const [boardId, ids] of targets)
      changed += await recomputeItems(unit, request.tenantId, boardId, ids, false);
    return changed;
  });
}

/** Itens a recalcular quando `itemIds` mudam: os próprios, seus pais e quem se relaciona com eles. */
async function dependentsOf(
  tx: Transaction,
  boardId: string,
  itemIds: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, Set<string>>();
  const add = (board: string, id: string) => {
    const set = result.get(board) ?? new Set<string>();
    set.add(id);
    result.set(board, set);
  };
  const rows = await tx
    .select({ id: items.id, parentItemId: items.parentItemId })
    .from(items)
    .where(inArray(items.id, [...itemIds]));
  for (const row of rows) {
    add(boardId, row.id);
    if (row.parentItemId !== null) add(boardId, row.parentItemId);
  }
  // Colunas de relação (de qualquer board) que apontam para este board.
  const relations = await tx
    .select({ boardId: columnDefinitions.boardId, key: columnDefinitions.key })
    .from(columnDefinitions)
    .where(
      and(
        eq(columnDefinitions.type, 'board_relation'),
        isNull(columnDefinitions.deletedAt),
        sql`${columnDefinitions.settings} -> 'boardIds' ? ${boardId}::text`,
      ),
    );
  for (const relation of relations) {
    for (const itemId of itemIds) {
      const dependents = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.boardId, relation.boardId),
            isNull(items.deletedAt),
            sql`${items.values} @> ${JSON.stringify({ [relation.key]: { itemIds: [itemId] } })}::jsonb`,
          ),
        )
        .limit(MAX_DEPENDENTS);
      for (const dependent of dependents) add(relation.boardId, dependent.id);
    }
  }
  return new Map([...result].map(([board, set]) => [board, [...set]]));
}

async function computeContext(
  tx: Transaction,
  tenantId: string,
  definition: StoredBoardDefinition,
): Promise<ComputeContext> {
  const [tenant] = await tx
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tenant?.timezone ?? 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const usesWorkdays = definition.columns.some(
    (column) =>
      column.type === 'formula' &&
      /WORKDAYS?\s*\(|ADD_WORKDAYS\s*\(/i.test(
        typeof column.settings.expression === 'string' ? column.settings.expression : '',
      ),
  );
  return {
    today,
    now: new Date().toISOString(),
    calendar: usesWorkdays
      ? await loadWorkingCalendar(tx, tenantId, definition.boardId, shiftDays(today, -366 * 5))
      : DEFAULT_CALENDAR,
  };
}

/** Recalcula os itens de um board e grava/emite as mudanças. Retorna quantos mudaram. */
async function recomputeItems(
  unit: Parameters<Parameters<typeof runAsSystem>[4]>[0],
  tenantId: string,
  boardId: string,
  itemIds: readonly string[],
  volatileOnly: boolean,
): Promise<number> {
  if (itemIds.length === 0) return 0;
  const tx = unit.tx;
  const definition = await loadBoardDefinition(tx, boardId);
  if (definition === null || !hasComputed(definition)) return 0;
  const context = await computeContext(tx, tenantId, definition);
  const rows = await tx
    .select()
    .from(items)
    .where(and(inArray(items.id, [...itemIds]), isNull(items.deletedAt)))
    .for('update');
  const cross = crossItemColumns(definition);
  const subitemRows =
    cross.length === 0 || volatileOnly
      ? []
      : await tx
          .select()
          .from(items)
          .where(
            and(
              inArray(
                items.parentItemId,
                rows.map((row) => row.id),
              ),
              isNull(items.deletedAt),
              isNull(items.archivedAt),
            ),
          );
  const related = volatileOnly
    ? new Map<string, { item: ComputedItem; definition: StoredBoardDefinition }>()
    : await loadRelated(tx, definition, rows);
  const columns = definition.columns.map(toComputedColumn);
  let changedCount = 0;
  for (const row of rows) {
    const current = toComputedItem(row);
    const values: Record<string, unknown> = { ...row.values };
    const changes = new Map<string, ComputedValue | null>();
    if (!volatileOnly) {
      const subitems = subitemRows.filter((sub) => sub.parentItemId === row.id).map(toComputedItem);
      for (const [key, value] of computeCrossColumns(
        definition,
        current,
        { subitems, related },
        context.now,
      ))
        changes.set(key, value);
    }
    for (const [key, value] of changes) {
      if (value === null) Reflect.deleteProperty(values, key);
      else values[key] = value;
    }
    for (const [key, value] of computeItemColumns(columns, { ...current, values }, context, {
      volatileOnly,
    })) {
      changes.set(key, value);
      if (value === null) Reflect.deleteProperty(values, key);
      else values[key] = value;
    }
    if (changes.size === 0) continue;
    const fieldVersions = { ...row.fieldVersions };
    const fieldChanges: ItemFieldChange[] = [];
    for (const [key, value] of changes) {
      fieldVersions[key] = (fieldVersions[key] ?? 0) + 1;
      fieldChanges.push({ field: key, kind: 'column', value, version: fieldVersions[key] });
    }
    await tx
      .update(items)
      .set({
        values: values as ItemRow['values'],
        fieldVersions,
        version: row.version + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(items.id, row.id));
    await unit.emit({
      type: 'item.updated',
      aggregateType: 'item',
      aggregateId: row.id,
      boardId,
      itemId: row.id,
      payload: { itemId: row.id, version: row.version + 1, changes: fieldChanges },
      routing: { columnKeys: fieldChanges.map((change) => change.field) },
      actorId: null,
    });
    changedCount += 1;
  }
  return changedCount;
}

/** Itens relacionados (e definições dos boards deles) usados por espelhos e rollups por relação. */
async function loadRelated(
  tx: Transaction,
  definition: StoredBoardDefinition,
  rows: readonly ItemRow[],
): Promise<Map<string, { item: ComputedItem; definition: StoredBoardDefinition }>> {
  const relationKeys = crossItemColumns(definition)
    .filter((column) => column.type === 'mirror' || column.settings.source === 'relation')
    .map((column) => String(column.settings.relationColumnKey));
  const ids = new Set<string>();
  for (const row of rows) {
    for (const key of relationKeys) {
      const list = (row.values[key] as { itemIds?: unknown } | undefined)?.itemIds;
      if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
    }
  }
  const result = new Map<string, { item: ComputedItem; definition: StoredBoardDefinition }>();
  if (ids.size === 0) return result;
  const relatedRows = await tx
    .select()
    .from(items)
    .where(and(inArray(items.id, [...ids]), isNull(items.deletedAt)));
  const definitions = new Map<string, StoredBoardDefinition | null>();
  for (const row of relatedRows) {
    if (!definitions.has(row.boardId))
      definitions.set(row.boardId, await loadBoardDefinition(tx, row.boardId));
    const related = definitions.get(row.boardId);
    if (related !== null && related !== undefined)
      result.set(row.id, { item: toComputedItem(row), definition: related });
  }
  return result;
}

/** Agenda o recálculo das fórmulas voláteis (TODAY/NOW) de todos os boards que as usam. */
export async function scheduleVolatile(database: DatabaseHandle, queue: Queue): Promise<number> {
  const result = await database.db.execute<{ tenant_id: string; board_id: string }>(
    sql`select tenant_id, board_id from app.volatile_formula_boards()`,
  );
  for (const row of result.rows) {
    const job: ComputedJob = {
      tenantId: row.tenant_id,
      boardId: row.board_id,
      itemIds: [],
      volatileOnly: true,
      causationId: null,
      depth: 0,
    };
    await queue.add('recompute-volatile', job);
  }
  return result.rows.length;
}
