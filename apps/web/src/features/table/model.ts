import {
  Decimal,
  formatCellText,
  isReadOnlyColumnType,
  storedNumber,
  type CellTextDirectory,
  type CellTextLocale,
  type ItemState,
  type RequirementColumn,
} from '@cube-track/shared';

import type { BoardColumn, BoardDetail, Item } from '@/lib/api/types';

/**
 * Modelo puro da Tabela (sem React): colunas visíveis, agrupamento em vários níveis, linhas
 * heterogêneas para a virtualização e agregados de rodapé. Testado em `model.test.ts`.
 */

// ------------------------------------------------------------------------------- colunas ---

export const NAME_COLUMN_KEY = 'name';
export const DEFAULT_COLUMN_WIDTH = 160;
export const NAME_COLUMN_WIDTH = 320;
export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 800;

/** Coluna da grade: a coluna "Item" (nome) é nativa e sempre fixada à esquerda. */
export interface GridColumn {
  key: string;
  title: string;
  width: number;
  pinned: boolean;
  /** Coluna do board (ausente para a coluna de nome). */
  column: BoardColumn | null;
  /** Abre editor (inclui dependências, que têm fluxo próprio). */
  editable: boolean;
  /** Aceita escrita direta de valor (colar, limpar, preencher). */
  writable: boolean;
}

export interface LayoutState {
  hiddenColumnKeys: readonly string[];
  columnOrder?: readonly string[];
  columnWidths?: Readonly<Record<string, number>>;
  pinnedColumnKeys?: readonly string[];
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

function canUpdateItems(board: BoardDetail): boolean {
  return (
    board.permissions.includes('item.update') || board.permissions.includes('item.update_assigned')
  );
}

/** A célula aceita valor digitado/colado? (permissão de board e de coluna, tipos somente leitura) */
export function canWriteColumn(board: BoardDetail, column: BoardColumn | null): boolean {
  if (!canUpdateItems(board)) return false;
  if (column === null) return true;
  return column.canEdit && !isReadOnlyColumnType(column.type);
}

/** A célula abre editor? Dependências são somente leitura como valor, mas têm editor próprio. */
export function canEditColumn(board: BoardDetail, column: BoardColumn | null): boolean {
  if (column?.type === 'dependency') return canUpdateItems(board) && column.canEdit;
  return canWriteColumn(board, column);
}

/**
 * Colunas na ordem de exibição: nome, depois as fixadas e as demais (ordem da view ou do board).
 * Colunas ocultas pela view ou marcadas como ocultas no board ficam de fora.
 */
export function gridColumns(
  board: BoardDetail,
  state: LayoutState,
  nameTitle: string,
): GridColumn[] {
  const hidden = new Set(state.hiddenColumnKeys);
  const order = state.columnOrder ?? [];
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const pinned = new Set(state.pinnedColumnKeys ?? []);
  const columns = board.columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !hidden.has(column.key) && !column.isHidden)
    .sort(
      (a, b) =>
        Number(pinned.has(b.column.key)) - Number(pinned.has(a.column.key)) ||
        rank(a.column.key) - rank(b.column.key) ||
        a.index - b.index,
    )
    .map(
      ({ column }): GridColumn => ({
        key: column.key,
        title: column.title,
        width: clampWidth(state.columnWidths?.[column.key] ?? column.width ?? DEFAULT_COLUMN_WIDTH),
        pinned: pinned.has(column.key),
        column,
        editable: canEditColumn(board, column),
        writable: canWriteColumn(board, column),
      }),
    );
  return [
    {
      key: NAME_COLUMN_KEY,
      title: nameTitle,
      width: clampWidth(state.columnWidths?.[NAME_COLUMN_KEY] ?? NAME_COLUMN_WIDTH),
      pinned: true,
      column: null,
      editable: canEditColumn(board, null),
      writable: canWriteColumn(board, null),
    },
    ...columns,
  ];
}

/** Nova ordem após arrastar `key` para antes de `beforeKey` (null = fim). */
export function reorderKeys(
  keys: readonly string[],
  key: string,
  beforeKey: string | null,
): string[] {
  const without = keys.filter((entry) => entry !== key);
  const index = beforeKey === null ? -1 : without.indexOf(beforeKey);
  if (index === -1) return [...without, key];
  return [...without.slice(0, index), key, ...without.slice(index)];
}

// ------------------------------------------------------------------- valores e estado ---

const NATIVE_BY_BINDING: Record<string, keyof Item> = {
  'item.planned_start_date': 'plannedStartDate',
  'item.planned_end_date': 'plannedEndDate',
  'item.replanned_start_date': 'replannedStartDate',
  'item.replanned_end_date': 'replannedEndDate',
  'item.actual_start_date': 'actualStartDate',
  'item.actual_end_date': 'actualEndDate',
  'item.progress': 'progress',
};

/** Campo nativo (API, camelCase) de uma coluna vinculada (`item.planned_end_date`…). */
export function nativeFieldOf(column: BoardColumn): keyof Item | null {
  return column.binding === null ? null : (NATIVE_BY_BINDING[column.binding] ?? null);
}

/** Valor bruto da célula, considerando colunas vinculadas a campos nativos. */
export function cellValue(item: Item, column: BoardColumn): unknown {
  const native = nativeFieldOf(column);
  if (native !== null) {
    const value = item[native];
    if (value === null || value === undefined) return null;
    return column.type === 'date' ? { d: value } : { n: value };
  }
  return item.values[column.key] ?? null;
}

/** Corpo da escrita de uma célula: colunas vinculadas viram `fields`, as demais `values`. */
export function cellWrite(
  column: BoardColumn,
  value: Record<string, unknown> | null,
): { values?: Record<string, unknown>; fields?: Record<string, string | null> } {
  const native = nativeFieldOf(column);
  if (native === null) return { values: { [column.key]: value } };
  const raw = value === null ? null : (value.d ?? value.n ?? null);
  return { fields: { [native]: typeof raw === 'string' ? raw : null } };
}

/** Aplica localmente (otimista) uma escrita de célula. */
export function applyCellWrite(item: Item, column: BoardColumn, value: unknown): Item {
  const native = nativeFieldOf(column);
  if (native !== null) {
    const record = value as Record<string, unknown> | null;
    const raw = record === null ? null : (record.d ?? record.n ?? null);
    return { ...item, [native]: typeof raw === 'string' ? raw : null };
  }
  const values = { ...item.values };
  if (value === null || value === undefined) Reflect.deleteProperty(values, column.key);
  else values[column.key] = value;
  return { ...item, values };
}

export function cellTextOf(
  item: Item,
  column: BoardColumn,
  directory: CellTextDirectory,
  locale: CellTextLocale,
  withUnit = true,
): string {
  if (item.redactedFields.includes(column.key)) return '';
  return formatCellText(column, cellValue(item, column), directory, {
    locale,
    withUnit,
    item: {
      id: item.id,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdBy: item.createdBy,
      updatedBy: item.updatedBy,
    },
  });
}

/** Coluna de status principal do board (conclusão e "atrasados"). */
export function mainStatusColumn(board: BoardDetail): BoardColumn | null {
  const statuses = board.columns.filter((column) => column.type === 'status');
  return (
    statuses.find((column) => column.key === board.settings.statusColumnKey) ??
    statuses.find((column) => column.key === 'c_status') ??
    statuses[0] ??
    null
  );
}

export function isItemDone(board: BoardDetail, values: Readonly<Record<string, unknown>>): boolean {
  const status = mainStatusColumn(board);
  if (status === null) return false;
  const labelId = (values[status.key] as { labelId?: unknown } | undefined)?.labelId;
  return status.labels.some((label) => label.id === labelId && label.category === 'done');
}

/** Estado avaliável do item (mesma forma que a API usa para obrigatoriedade e filtros). */
export function toItemState(board: BoardDetail, item: Item): ItemState {
  return {
    name: item.name,
    groupId: item.groupId,
    values: item.values,
    fields: {
      planned_start_date: item.plannedStartDate,
      planned_end_date: item.plannedEndDate,
      replanned_start_date: item.replannedStartDate,
      replanned_end_date: item.replannedEndDate,
      actual_start_date: item.actualStartDate,
      actual_end_date: item.actualEndDate,
      progress: item.progress,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    },
    completed: isItemDone(board, item.values),
  };
}

export function requirementColumns(board: BoardDetail): RequirementColumn[] {
  return board.columns.map((column) => ({
    key: column.key,
    type: column.type,
    title: column.title,
    binding: column.binding,
    isRequired: column.isRequired,
    requiredWhen: column.requiredWhen,
  }));
}

/** Hoje (AAAA-MM-DD) no fuso informado. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ----------------------------------------------------------------------------- agrupamento ---

/** Tipos de coluna pelos quais a Tabela agrupa (além do grupo do board). */
export const GROUPABLE_TYPES = new Set([
  'status',
  'dropdown',
  'people',
  'checkbox',
  'date',
  'tags',
  'country',
  'text',
  'rating',
]);

export const GROUP_LEVEL_GROUP = 'group';
export const NONE_BUCKET = '∅';

export interface Bucket {
  key: string;
  label: string;
  color: string;
  /** Grupo do board (só no nível "grupo"), usado para criar itens e ações de grupo. */
  groupId: string | null;
  items: Item[];
}

export interface BucketLabels {
  none: string;
  checked: string;
  unchecked: string;
  /** Nome de uma pessoa pelo id. */
  person: (id: string) => string;
  /** Rótulo de mês (`2026-10` → "outubro de 2026"). */
  month: (yearMonth: string) => string;
}

const NONE_COLOR = '#c4c4c4';

function firstOf(value: unknown, property: string): string | null {
  const list = (value as Record<string, unknown> | null)?.[property];
  return Array.isArray(list) && typeof list[0] === 'string' ? list[0] : null;
}

/** Chave de agrupamento de um item numa coluna (`NONE_BUCKET` quando vazio). */
export function bucketKeyOf(item: Item, column: BoardColumn): string {
  const value = cellValue(item, column) as Record<string, unknown> | null;
  switch (column.type) {
    case 'status':
      return typeof value?.labelId === 'string' ? value.labelId : NONE_BUCKET;
    case 'dropdown':
      return firstOf(value, 'optionIds') ?? NONE_BUCKET;
    case 'people':
      return firstOf(value, 'personIds') ?? NONE_BUCKET;
    case 'tags':
      return firstOf(value, 'tags') ?? NONE_BUCKET;
    case 'checkbox':
      return value?.checked === true ? 'true' : 'false';
    case 'date':
      return typeof value?.d === 'string' ? value.d.slice(0, 7) : NONE_BUCKET;
    case 'country':
      return typeof value?.code === 'string' ? value.code : NONE_BUCKET;
    case 'rating':
      return typeof value?.n === 'string' ? value.n : NONE_BUCKET;
    default: {
      const text = typeof value?.text === 'string' ? value.text.trim() : '';
      return text === '' ? NONE_BUCKET : text;
    }
  }
}

/** Divide itens em baldes por um nível (grupo do board ou coluna), preservando a ordem. */
export function bucketize(
  board: BoardDetail,
  items: readonly Item[],
  level: string,
  labels: BucketLabels,
  includeEmptyGroups: boolean,
): Bucket[] {
  if (level === GROUP_LEVEL_GROUP) {
    const byGroup = new Map<string, Item[]>();
    for (const item of items) {
      const list = byGroup.get(item.groupId);
      if (list === undefined) byGroup.set(item.groupId, [item]);
      else list.push(item);
    }
    return board.groups
      .map((group) => ({
        key: group.id,
        label: group.name,
        color: group.color,
        groupId: group.id,
        items: byGroup.get(group.id) ?? [],
      }))
      .filter((bucket) => includeEmptyGroups || bucket.items.length > 0);
  }
  const column = board.columns.find((entry) => entry.key === level);
  if (column === undefined)
    return bucketize(board, items, GROUP_LEVEL_GROUP, labels, includeEmptyGroups);
  const byKey = new Map<string, Item[]>();
  for (const item of items) {
    const key = bucketKeyOf(item, column);
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [item]);
    else list.push(item);
  }
  const make = (key: string, label: string, color: string): Bucket => ({
    key,
    label,
    color,
    groupId: null,
    items: byKey.get(key) ?? [],
  });
  let buckets: Bucket[];
  switch (column.type) {
    case 'status':
      buckets = column.labels.map((label) => make(label.id, label.label, label.color));
      break;
    case 'dropdown':
      buckets = column.options.map((option) =>
        make(option.id, option.label, option.color ?? NONE_COLOR),
      );
      break;
    case 'checkbox':
      buckets = [
        make('true', labels.checked, '#00c875'),
        make('false', labels.unchecked, NONE_COLOR),
      ];
      break;
    default: {
      const keys = [...byKey.keys()].filter((key) => key !== NONE_BUCKET).sort();
      buckets = keys.map((key) =>
        make(
          key,
          column.type === 'people'
            ? labels.person(key)
            : column.type === 'date'
              ? labels.month(key)
              : key,
          column.type === 'people' ? '#579bfc' : '#a25ddc',
        ),
      );
    }
  }
  const known = new Set(buckets.map((bucket) => bucket.key));
  const orphans = [...byKey.entries()]
    .filter(([key]) => key !== NONE_BUCKET && !known.has(key))
    .flatMap(([, list]) => list);
  const none = [...(byKey.get(NONE_BUCKET) ?? []), ...orphans];
  return [
    ...buckets.filter((bucket) => bucket.items.length > 0),
    ...(none.length === 0
      ? []
      : [{ key: NONE_BUCKET, label: labels.none, color: NONE_COLOR, groupId: null, items: none }]),
  ];
}

// ---------------------------------------------------------------------------------- linhas ---

export type TableRow =
  | {
      kind: 'header';
      id: string;
      path: string;
      level: number;
      bucket: Bucket;
      collapsed: boolean;
      /** Grupo do board de referência (para criar itens no balde). */
      groupId: string | null;
      color: string;
    }
  | {
      kind: 'item';
      id: string;
      item: Item;
      depth: 0 | 1;
      level: number;
      color: string;
      path: string;
    }
  | {
      kind: 'add';
      id: string;
      groupId: string;
      parentItemId: string | null;
      level: number;
      depth: 0 | 1;
      color: string;
      label: string;
    }
  | { kind: 'footer'; id: string; path: string; level: number; items: Item[]; color: string };

export const ROW_HEIGHT = { header: 44, item: 36, add: 36, footer: 36 } as const;

export interface RowModelInput {
  board: BoardDetail;
  items: readonly Item[];
  levels: readonly string[];
  labels: BucketLabels;
  collapsed: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  subitems: ReadonlyMap<string, readonly Item[]>;
  canCreate: boolean;
  /** Mostra grupos vazios (sem filtros ativos). */
  includeEmptyGroups: boolean;
}

/**
 * Linhas planas para a virtualização: cabeçalho de balde, itens (e subitens expandidos), linha de
 * "adicionar" e rodapé com agregados, em até 3 níveis de agrupamento.
 */
export function buildRows(input: RowModelInput): TableRow[] {
  const rows: TableRow[] = [];
  const levels = input.levels.length === 0 ? [GROUP_LEVEL_GROUP] : input.levels.slice(0, 3);

  const pushItems = (
    items: readonly Item[],
    level: number,
    color: string,
    path: string,
    groupId: string | null,
  ) => {
    for (const item of items) {
      rows.push({ kind: 'item', id: item.id, item, depth: 0, level, color, path });
      if (!input.expanded.has(item.id)) continue;
      for (const sub of input.subitems.get(item.id) ?? [])
        rows.push({ kind: 'item', id: sub.id, item: sub, depth: 1, level, color, path });
      if (input.canCreate)
        rows.push({
          kind: 'add',
          id: `add-sub:${item.id}`,
          groupId: item.groupId,
          parentItemId: item.id,
          level,
          depth: 1,
          color,
          label: item.name,
        });
    }
    if (input.canCreate && groupId !== null)
      rows.push({
        kind: 'add',
        id: `add:${path}`,
        groupId,
        parentItemId: null,
        level,
        depth: 0,
        color,
        label: '',
      });
  };

  const visit = (
    items: readonly Item[],
    depth: number,
    parentPath: string,
    inheritedGroup: string | null,
  ) => {
    const level = levels[depth] ?? GROUP_LEVEL_GROUP;
    const buckets = bucketize(
      input.board,
      items,
      level,
      input.labels,
      depth === 0 && input.includeEmptyGroups,
    );
    for (const bucket of buckets) {
      const path =
        parentPath === '' ? `${level}=${bucket.key}` : `${parentPath}/${level}=${bucket.key}`;
      const collapsed = input.collapsed.has(path);
      const groupId = bucket.groupId ?? inheritedGroup;
      rows.push({
        kind: 'header',
        id: `h:${path}`,
        path,
        level: depth,
        bucket,
        collapsed,
        groupId,
        color: bucket.color,
      });
      if (collapsed) continue;
      if (depth + 1 < levels.length) visit(bucket.items, depth + 1, path, groupId);
      else pushItems(bucket.items, depth, bucket.color, path, groupId);
      rows.push({
        kind: 'footer',
        id: `f:${path}`,
        path,
        level: depth,
        items: bucket.items,
        color: bucket.color,
      });
    }
  };

  visit(input.items, 0, '', null);
  return rows;
}

export function rowHeight(row: TableRow): number {
  return ROW_HEIGHT[row.kind];
}

// ------------------------------------------------------------------------------ agregados ---

export type NumericAggregate = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'none';

export type Aggregate =
  | { kind: 'numeric'; aggregate: NumericAggregate; value: string | null }
  | {
      kind: 'distribution';
      segments: { key: string; label: string; color: string; count: number }[];
      total: number;
    }
  | { kind: 'count'; filled: number; total: number }
  | { kind: 'none' };

const NUMERIC_TYPES = new Set([
  'number',
  'rating',
  'time_tracking',
  'formula',
  'rollup',
  'mirror',
  'progress',
]);

/** Agregado de rodapé de uma coluna para os itens de um balde. */
export function columnAggregate(column: BoardColumn, items: readonly Item[]): Aggregate {
  if (column.type === 'status' || column.type === 'dropdown') {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.redactedFields.includes(column.key)) continue;
      const key = bucketKeyOf(item, column);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const entries =
      column.type === 'status'
        ? column.labels.map((label) => ({ key: label.id, label: label.label, color: label.color }))
        : column.options.map((option) => ({
            key: option.id,
            label: option.label,
            color: option.color ?? NONE_COLOR,
          }));
    const segments = entries
      .map((entry) => ({ ...entry, count: counts.get(entry.key) ?? 0 }))
      .filter((segment) => segment.count > 0);
    const known = segments.reduce((sum, segment) => sum + segment.count, 0);
    const empty = items.length - known;
    return {
      kind: 'distribution',
      segments:
        empty > 0
          ? [...segments, { key: NONE_BUCKET, label: '', color: NONE_COLOR, count: empty }]
          : segments,
      total: items.length,
    };
  }
  if (NUMERIC_TYPES.has(column.type)) {
    const configured = column.settings.aggregate;
    const aggregate: NumericAggregate =
      typeof configured === 'string' &&
      ['sum', 'avg', 'min', 'max', 'count', 'none'].includes(configured)
        ? (configured as NumericAggregate)
        : column.type === 'progress' || column.type === 'rating'
          ? 'avg'
          : 'sum';
    if (aggregate === 'none') return { kind: 'none' };
    const numbers: Decimal[] = [];
    for (const item of items) {
      if (item.redactedFields.includes(column.key)) continue;
      const value = storedNumber(cellValue(item, column));
      if (value !== null) numbers.push(value);
    }
    if (aggregate === 'count') return { kind: 'numeric', aggregate, value: String(numbers.length) };
    if (numbers.length === 0) return { kind: 'numeric', aggregate, value: null };
    let result: Decimal;
    switch (aggregate) {
      case 'avg':
        result = numbers
          .reduce((sum, value) => sum.plus(value), new Decimal(0))
          .dividedBy(numbers.length);
        break;
      case 'min':
        result = numbers.reduce((min, value) => (value.lessThan(min) ? value : min));
        break;
      case 'max':
        result = numbers.reduce((max, value) => (value.greaterThan(max) ? value : max));
        break;
      default:
        result = numbers.reduce((sum, value) => sum.plus(value), new Decimal(0));
    }
    return { kind: 'numeric', aggregate, value: result.toDecimalPlaces(4).toString() };
  }
  if (['button', 'item_id', 'creation_log', 'last_updated', 'dependency'].includes(column.type))
    return { kind: 'none' };
  let filled = 0;
  for (const item of items) {
    const value = cellValue(item, column);
    if (value !== null && value !== undefined && !item.redactedFields.includes(column.key))
      filled += 1;
  }
  return { kind: 'count', filled, total: items.length };
}
