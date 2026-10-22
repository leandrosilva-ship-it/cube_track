import type { BoardColumn, BoardDetail, Item } from '@/lib/api/types';

/** Campos nativos de data do item — chave literal aceita por `dateColumnKey`/`startColumnKey`/etc. */
export const NATIVE_DATE_FIELD_KEYS = [
  'plannedStartDate',
  'plannedEndDate',
  'replannedStartDate',
  'replannedEndDate',
  'actualStartDate',
  'actualEndDate',
] as const;

const NATIVE_DATE_FIELDS = new Set<string>(NATIVE_DATE_FIELD_KEYS);

function isNativeDateField(key: string): key is keyof Pick<
  Item,
  | 'plannedStartDate'
  | 'plannedEndDate'
  | 'replannedStartDate'
  | 'replannedEndDate'
  | 'actualStartDate'
  | 'actualEndDate'
> {
  return NATIVE_DATE_FIELDS.has(key);
}

/** Data (`YYYY-MM-DD`) de um item pela chave configurada na view: campo nativo ou coluna `date`. */
export function dateValueOf(item: Item, key: string): string | null {
  if (isNativeDateField(key)) return item[key];
  const raw = item.values[key] as { d?: unknown } | null | undefined;
  return typeof raw?.d === 'string' ? raw.d : null;
}

/** Grava a data pela mesma convenção: campo nativo vira `fields`, coluna `date` vira `values`. */
export function dateWritePayload(
  key: string,
  value: string | null,
): { fields?: Record<string, string | null>; values?: Record<string, unknown> } {
  if (isNativeDateField(key)) return { fields: { [key]: value } };
  return { values: { [key]: value === null ? null : { d: value } } };
}

/**
 * Grava início e fim num só PATCH (Timeline: arrastar/redimensionar uma barra move uma ou ambas as
 * pontas) — cada chave segue independentemente a mesma convenção campo nativo/coluna de `dateWritePayload`.
 */
export function rangeWritePayload(
  startKey: string,
  endKey: string,
  start: string,
  end: string,
): { fields?: Record<string, string | null>; values?: Record<string, unknown> } {
  const a = dateWritePayload(startKey, start);
  const b = dateWritePayload(endKey, end);
  return {
    ...(a.fields === undefined && b.fields === undefined
      ? {}
      : { fields: { ...a.fields, ...b.fields } }),
    ...(a.values === undefined && b.values === undefined
      ? {}
      : { values: { ...a.values, ...b.values } }),
  };
}

/** Rótulo de uma coluna/campo de data configurada, para exibir nas configurações da view. */
export function dateFieldLabel(board: BoardDetail, key: string, fallback: string): string {
  if (isNativeDateField(key)) return fallback;
  return board.columns.find((column) => column.key === key)?.title ?? key;
}

/** Colunas de data reais do board (para o seletor "campo de data" nas configurações da view). */
export function dateColumnsOf(board: BoardDetail): BoardColumn[] {
  return board.columns.filter((column) => column.type === 'date');
}

/** Cor (classe Tailwind) por valor de uma coluna de status/opção — mesma paleta do rótulo. */
export function colorOf(item: Item, board: BoardDetail, colorByKey: string | undefined): string | null {
  if (colorByKey === undefined) return null;
  const column = board.columns.find((entry) => entry.key === colorByKey);
  if (column === undefined) return null;
  const raw = item.values[colorByKey] as { labelId?: string; optionIds?: string[] } | null | undefined;
  if (column.type === 'status' && typeof raw?.labelId === 'string') {
    return column.labels.find((label) => label.id === raw.labelId)?.color ?? null;
  }
  if (column.type === 'dropdown' && Array.isArray(raw?.optionIds) && raw.optionIds.length > 0) {
    return column.options.find((option) => option.id === raw.optionIds?.[0])?.color ?? null;
  }
  return null;
}
