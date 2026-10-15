import {
  parseCellText,
  type CellTextDirectory,
  type CellTextLocale,
  type ParseCellResult,
} from '@cube-track/shared';

import type { Item } from '@/lib/api/types';

import { cellValue, type GridColumn } from './model';

/**
 * Copiar/colar como planilha: TSV (o formato que Excel, Google Sheets e LibreOffice trocam pela
 * área de transferência), com aspas para células com tabulação, quebra de linha ou aspas.
 */

function quote(cell: string): string {
  return /[\t\n\r"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toTsv(matrix: readonly (readonly string[])[]): string {
  return matrix.map((row) => row.map(quote).join('\t')).join('\n');
}

export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (quoted) {
      if (char === '"' && source.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface CellRange {
  /** Índices em `items` (linhas de item navegáveis) e `columns`. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function normalizeRange(
  anchor: { row: number; col: number },
  focus: { row: number; col: number },
): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

export type RejectReason = Extract<ParseCellResult, { ok: false }>['reason'];

/** Uma escrita planejada por item (nome e/ou colunas). */
export interface PlannedWrite {
  item: Item;
  name?: string;
  values: Record<string, Record<string, unknown> | null>;
}

export interface PastePlan {
  writes: PlannedWrite[];
  /** Células recusadas (somente leitura, sem permissão ou texto inválido). */
  rejected: { itemId: string; columnKey: string; reason: RejectReason }[];
}

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function addWrite(
  writes: Map<string, PlannedWrite>,
  item: Item,
  column: GridColumn,
  value: Record<string, unknown> | null | string,
): void {
  const write = writes.get(item.id) ?? { item, values: {} };
  if (column.column === null) write.name = value as string;
  else write.values[column.key] = value as Record<string, unknown> | null;
  writes.set(item.id, write);
}

/**
 * Planeja a colagem de uma matriz de texto a partir da célula `start`. Uma única célula copiada é
 * repetida em toda a seleção (`selection`), como nas planilhas.
 */
export function planPaste(
  matrix: readonly (readonly string[])[],
  start: { row: number; col: number },
  selection: CellRange | null,
  items: readonly Item[],
  columns: readonly GridColumn[],
  directory: CellTextDirectory,
  locale: CellTextLocale,
): PastePlan {
  const writes = new Map<string, PlannedWrite>();
  const rejected: PastePlan['rejected'] = [];
  const single = matrix.length === 1 && matrix[0]?.length === 1;
  const height =
    single && selection !== null ? selection.bottom - selection.top + 1 : matrix.length;
  const width =
    single && selection !== null ? selection.right - selection.left + 1 : (matrix[0]?.length ?? 0);
  const origin = single && selection !== null ? { row: selection.top, col: selection.left } : start;
  for (let r = 0; r < height; r += 1) {
    const item = items[origin.row + r];
    if (item === undefined) break;
    for (let c = 0; c < width; c += 1) {
      const column = columns[origin.col + c];
      if (column === undefined) break;
      const text = single ? (matrix[0]?.[0] ?? '') : (matrix[r]?.[c] ?? '');
      if (!column.writable || item.redactedFields.includes(column.key)) {
        rejected.push({ itemId: item.id, columnKey: column.key, reason: 'read_only' });
        continue;
      }
      if (column.column === null) {
        const name = text.trim();
        if (name === '')
          rejected.push({ itemId: item.id, columnKey: column.key, reason: 'invalid' });
        else if (name !== item.name) addWrite(writes, item, column, name.slice(0, 500));
        continue;
      }
      const parsed = parseCellText(column.column, text, directory, locale);
      if (!parsed.ok) {
        rejected.push({ itemId: item.id, columnKey: column.key, reason: parsed.reason });
        continue;
      }
      if (!sameValue(parsed.value, cellValue(item, column.column)))
        addWrite(writes, item, column, parsed.value);
    }
  }
  return { writes: [...writes.values()], rejected };
}

/** Preencher para baixo (Ctrl+D): replica a primeira linha da seleção nas demais. */
export function planFillDown(
  range: CellRange,
  items: readonly Item[],
  columns: readonly GridColumn[],
): PastePlan {
  const writes = new Map<string, PlannedWrite>();
  const rejected: PastePlan['rejected'] = [];
  const source = items[range.top];
  if (source === undefined) return { writes: [], rejected };
  for (let col = range.left; col <= range.right; col += 1) {
    const column = columns[col];
    if (column === undefined) continue;
    const value = column.column === null ? source.name : cellValue(source, column.column);
    for (let row = range.top + 1; row <= range.bottom; row += 1) {
      const item = items[row];
      if (item === undefined) break;
      if (!column.writable || item.redactedFields.includes(column.key)) {
        rejected.push({ itemId: item.id, columnKey: column.key, reason: 'read_only' });
        continue;
      }
      const current = column.column === null ? item.name : cellValue(item, column.column);
      if (!sameValue(value, current))
        addWrite(writes, item, column, value as Record<string, unknown> | null | string);
    }
  }
  return { writes: [...writes.values()], rejected };
}
