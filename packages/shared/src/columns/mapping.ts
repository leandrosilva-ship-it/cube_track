import { COMPUTED_COLUMN_TYPES, isColumnType, READ_ONLY_COLUMN_TYPES } from './registry.js';
import {
  formatCellText,
  normalizeForMatch,
  parseCellText,
  type CellTextColumn,
  type CellTextDirectory,
  type CellTextLocale,
} from './text.js';

/**
 * Mapeamento de colunas ao mover itens/grupos entre boards (ADR 0041): a sugestão casa chave ou
 * título com tipo compatível; a conversão mantém o valor no mesmo tipo (rótulos e opções pelo
 * texto) e, entre tipos diferentes, passa pelo texto da célula (mesma regra de colar/importar).
 */

export interface MappableColumn extends CellTextColumn {
  title: string;
  binding: string | null;
}

/** Colunas que recebem valor ao mover (não calculadas, não de sistema, não vinculadas). */
export function isMappableTarget(column: MappableColumn): boolean {
  return (
    column.binding === null &&
    !(isColumnType(column.type) && READ_ONLY_COLUMN_TYPES.has(column.type))
  );
}

function isMappableSource(column: MappableColumn): boolean {
  return (
    column.binding === null &&
    column.type !== 'button' &&
    !(isColumnType(column.type) && COMPUTED_COLUMN_TYPES.has(column.type))
  );
}

/** Sugestão de mapeamento origem → destino (`null` = descartar o valor). */
export function suggestColumnMapping(
  sources: readonly MappableColumn[],
  targets: readonly MappableColumn[],
): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  const available = targets.filter(isMappableTarget);
  for (const source of sources.filter(isMappableSource)) {
    const title = normalizeForMatch(source.title);
    const match =
      available.find(
        (target) =>
          !used.has(target.key) && target.key === source.key && target.type === source.type,
      ) ??
      available.find(
        (target) =>
          !used.has(target.key) &&
          target.type === source.type &&
          normalizeForMatch(target.title) === title,
      ) ??
      available.find(
        (target) => !used.has(target.key) && normalizeForMatch(target.title) === title,
      );
    mapping[source.key] = match?.key ?? null;
    if (match !== undefined) used.add(match.key);
  }
  return mapping;
}

function byLabel<T extends { id: string; label: string }>(
  sourceEntries: readonly T[] | undefined,
  targetEntries: readonly T[] | undefined,
  ids: readonly string[],
): string[] {
  const mapped: string[] = [];
  for (const id of ids) {
    const label = sourceEntries?.find((entry) => entry.id === id)?.label;
    if (label === undefined) continue;
    const target = targetEntries?.find(
      (entry) => normalizeForMatch(entry.label) === normalizeForMatch(label),
    );
    if (target !== undefined && !mapped.includes(target.id)) mapped.push(target.id);
  }
  return mapped;
}

/** Converte o valor de `source` para a coluna `target` (null = sem equivalente). */
export function remapColumnValue(
  source: MappableColumn,
  target: MappableColumn,
  value: unknown,
  directory: CellTextDirectory,
  locale: CellTextLocale = 'pt-BR',
): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || !isMappableTarget(target)) return null;
  const record = value as Record<string, unknown>;
  if (source.type === target.type) {
    if (source.type === 'status') {
      const [labelId] = byLabel(source.labels, target.labels, [String(record.labelId)]);
      return labelId === undefined ? null : { labelId };
    }
    if (source.type === 'dropdown') {
      const ids = Array.isArray(record.optionIds) ? record.optionIds.map(String) : [];
      const optionIds = byLabel(source.options, target.options, ids);
      return optionIds.length === 0 ? null : { optionIds };
    }
    if (source.type === 'file') return null;
    return record;
  }
  const text = formatCellText(source, record, directory, { locale });
  if (text === '') return null;
  const parsed = parseCellText(target, text, directory, locale);
  return parsed.ok ? parsed.value : null;
}
