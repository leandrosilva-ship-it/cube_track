import { Decimal } from '../decimal.js';

import type { WorkingCalendar } from '../business-days.js';
import {
  evaluateFormula,
  formulaReferences,
  formulaResultToText,
  isVolatileFormula,
  parseFormula,
  type FormulaAst,
  type FormulaResult,
  type FormulaValue,
} from '../formula/index.js';
import type { ComputedValue, MirrorAggregate, RollupAggregate } from './registry.js';

/**
 * Colunas calculadas (ADR 0038).
 *
 * - Fórmula e progresso por colunas de status dependem só do próprio item: a API calcula na mesma
 *   transação da escrita (`computeItemColumns`).
 * - Espelho, rollup e progresso por subitens dependem de outros itens: o worker recalcula quando os
 *   itens de origem mudam (`aggregateValues`), e então reaplica as fórmulas do item.
 */

export interface ComputedColumn {
  key: string;
  type: string;
  title: string;
  binding: string | null;
  settings: Readonly<Record<string, unknown>>;
  labels?: readonly { id: string; label: string; category: string }[];
  options?: readonly { id: string; label: string }[];
}

export interface ComputedItem {
  id: string;
  name: string;
  values: Readonly<Record<string, unknown>>;
  /** Campos nativos em snake_case (`planned_end_date`…), para colunas vinculadas. */
  fields: Readonly<Partial<Record<string, string | null>>>;
  createdAt: string;
  updatedAt: string;
}

export interface ComputeContext {
  today: string;
  now: string;
  calendar: WorkingCalendar;
  /** Nomes de pessoas, times e itens relacionados (fórmulas que leem essas colunas). */
  names?: (id: string) => string | undefined;
}

const MAX_DECIMAL = new Decimal('99999999999999.9999');

function decimalOrNull(value: unknown): Decimal | null {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  return new Decimal(value);
}

/** Decimal no formato de armazenamento (até 4 casas, sem notação científica). */
export function toStorageDecimal(value: Decimal): string | null {
  const rounded = value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  if (rounded.abs().greaterThan(MAX_DECIMAL)) return null;
  return rounded.toFixed(4).replace(/\.?0+$/, '') || '0';
}

const text = (value: string): FormulaValue => ({ kind: 'text', value });
const EMPTY: FormulaValue = { kind: 'empty' };

/** Valor de uma coluna como entrada de fórmula. */
export function columnValueToFormula(
  column: ComputedColumn,
  item: ComputedItem,
  names: ComputeContext['names'],
): FormulaValue {
  if (column.binding?.startsWith('item.') === true) {
    const field = item.fields[column.binding.slice(5)];
    if (field === null || field === undefined) return EMPTY;
    return column.binding === 'item.progress'
      ? { kind: 'number', value: field }
      : { kind: 'date', value: field };
  }
  if (column.type === 'item_id') return text(item.id);
  if (column.type === 'creation_log') return { kind: 'datetime', value: item.createdAt };
  if (column.type === 'last_updated') return { kind: 'datetime', value: item.updatedAt };
  const raw = item.values[column.key];
  if (typeof raw !== 'object' || raw === null) return EMPTY;
  const value = raw as Record<string, unknown>;
  const str = (key: string) => {
    const entry = value[key];
    return typeof entry === 'string' ? entry : null;
  };
  const ids = (key: string) =>
    Array.isArray(value[key]) ? (value[key] as unknown[]).map(String) : [];
  const nameList = (list: string[]): FormulaValue => ({
    kind: 'list',
    items: list.map((id) => text(names?.(id) ?? id)),
  });
  switch (column.type) {
    case 'number':
    case 'rating':
    case 'time_tracking': {
      const n = str('n');
      return n === null ? EMPTY : { kind: 'number', value: n };
    }
    case 'formula':
    case 'mirror':
    case 'rollup':
    case 'progress': {
      if (str('error') !== null) return EMPTY;
      const n = str('n');
      if (n !== null) return { kind: 'number', value: n };
      const d = str('d');
      if (d !== null) return { kind: 'date', value: d };
      const content = str('text');
      return content === null ? EMPTY : text(content);
    }
    case 'date': {
      const d = str('d');
      if (d === null) return EMPTY;
      const time = str('time');
      return time === null
        ? { kind: 'date', value: d }
        : { kind: 'datetime', value: `${d}T${time}:00.000Z` };
    }
    case 'timeline':
    case 'week': {
      const from = str('from');
      const to = str('to');
      return from === null || to === null
        ? EMPTY
        : {
            kind: 'list',
            items: [
              { kind: 'date', value: from },
              { kind: 'date', value: to },
            ],
          };
    }
    case 'checkbox':
      return { kind: 'boolean', value: value.checked === true };
    case 'status': {
      const label = column.labels?.find((entry) => entry.id === str('labelId'));
      return label === undefined ? EMPTY : text(label.label);
    }
    case 'dropdown':
      return {
        kind: 'list',
        items: ids('optionIds').map((id) =>
          text(column.options?.find((option) => option.id === id)?.label ?? id),
        ),
      };
    case 'people':
      return nameList([...ids('personIds'), ...ids('teamIds')]);
    case 'board_relation':
      return nameList(ids('itemIds'));
    case 'tags':
      return { kind: 'list', items: ids('tags').map(text) };
    case 'file':
      return { kind: 'number', value: String(ids('attachmentIds').length) };
    case 'vote':
      return { kind: 'number', value: String(ids('userIds').length) };
    case 'link': {
      const content = str('text') ?? str('url');
      return content === null ? EMPTY : text(content);
    }
    case 'auto_id':
    case 'text':
    case 'long_text': {
      const content = str('text');
      return content === null ? EMPTY : text(content);
    }
    default: {
      const content =
        str('email') ??
        str('phone') ??
        str('address') ??
        str('color') ??
        str('time') ??
        str('code');
      return content === null ? EMPTY : text(content);
    }
  }
}

/** Resultado de fórmula/agregação → valor armazenado (null = vazio). */
export function toComputedValue(result: FormulaResult, now: string): ComputedValue | null {
  switch (result.kind) {
    case 'empty':
      return null;
    case 'error':
      return { text: result.code, error: result.code, computedAt: now };
    case 'number': {
      const n = toStorageDecimal(new Decimal(result.value));
      return n === null
        ? { text: '#NUM!', error: '#NUM!', computedAt: now }
        : { n, computedAt: now };
    }
    case 'date':
      return { d: result.value, computedAt: now };
    case 'datetime':
      return { d: result.value.slice(0, 10), text: result.value, computedAt: now };
    default:
      return { text: formulaResultToText(result).slice(0, 10_000), computedAt: now };
  }
}

/** Fórmula compilada de uma coluna (null quando a expressão é inválida). */
export interface CompiledFormula {
  key: string;
  ast: FormulaAst | null;
  references: string[];
  volatile: boolean;
  syntaxError: string | null;
}

export function compileFormulaColumn(column: ComputedColumn): CompiledFormula {
  const expression =
    typeof column.settings.expression === 'string' ? column.settings.expression : '';
  try {
    const ast = parseFormula(expression);
    return {
      key: column.key,
      ast,
      references: formulaReferences(ast),
      volatile: isVolatileFormula(ast),
      syntaxError: null,
    };
  } catch (error) {
    return {
      key: column.key,
      ast: null,
      references: [],
      volatile: false,
      syntaxError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Ordem de avaliação das fórmulas (dependências primeiro); chaves em ciclo ficam de fora. */
export function formulaEvaluationOrder(formulas: readonly CompiledFormula[]): {
  order: CompiledFormula[];
  cyclic: Set<string>;
} {
  const byKey = new Map(formulas.map((formula) => [formula.key, formula]));
  const order: CompiledFormula[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const cyclic = new Set<string>();
  const visit = (formula: CompiledFormula, path: string[]): void => {
    const current = state.get(formula.key);
    if (current === 'done') return;
    if (current === 'visiting') {
      const start = path.indexOf(formula.key);
      for (const key of path.slice(start)) cyclic.add(key);
      return;
    }
    state.set(formula.key, 'visiting');
    for (const reference of formula.references) {
      const dependency = byKey.get(reference);
      if (dependency !== undefined) visit(dependency, [...path, formula.key]);
    }
    state.set(formula.key, 'done');
    order.push(formula);
  };
  for (const formula of formulas) visit(formula, []);
  return { order: order.filter((formula) => !cyclic.has(formula.key)), cyclic };
}

function statusDone(column: ComputedColumn, value: unknown): boolean | null {
  if (typeof value !== 'object' || value === null) return null;
  const labelId = (value as Record<string, unknown>).labelId;
  const label = column.labels?.find((entry) => entry.id === labelId);
  return label === undefined ? null : label.category === 'done';
}

/** Percentual de colunas de status concluídas no item (modo `status_columns`). */
export function statusProgress(
  column: ComputedColumn,
  columns: readonly ComputedColumn[],
  item: ComputedItem,
): string | null {
  const keys = Array.isArray(column.settings.sourceColumnKeys)
    ? (column.settings.sourceColumnKeys as string[])
    : columns.filter((entry) => entry.type === 'status').map((entry) => entry.key);
  const sources = columns.filter((entry) => entry.type === 'status' && keys.includes(entry.key));
  if (sources.length === 0) return null;
  const done = sources.filter(
    (source) => statusDone(source, item.values[source.key]) === true,
  ).length;
  return toStorageDecimal(new Decimal(done).times(100).dividedBy(sources.length));
}

/**
 * Recalcula as colunas calculadas do próprio item: progresso por status e fórmulas (em ordem de
 * dependência). Devolve apenas as chaves cujo valor mudou (null = limpar).
 */
export function computeItemColumns(
  columns: readonly ComputedColumn[],
  item: ComputedItem,
  context: ComputeContext,
  options: { volatileOnly?: boolean } = {},
): Map<string, ComputedValue | null> {
  const values: Record<string, unknown> = { ...item.values };
  const changes = new Map<string, ComputedValue | null>();
  const set = (key: string, next: ComputedValue | null) => {
    const previous = values[key] as ComputedValue | undefined;
    const same =
      (previous === undefined && next === null) ||
      (previous !== undefined &&
        next !== null &&
        previous.n === next.n &&
        previous.d === next.d &&
        previous.text === next.text &&
        previous.error === next.error);
    if (next === null) Reflect.deleteProperty(values, key);
    else values[key] = same && previous !== undefined ? previous : next;
    if (!same) changes.set(key, next);
  };

  if (options.volatileOnly !== true) {
    for (const column of columns) {
      if (column.type !== 'progress' || column.settings.mode === 'subitems') continue;
      const n = statusProgress(column, columns, item);
      set(column.key, n === null ? null : { n, computedAt: context.now });
    }
  }

  const compiled = columns.filter((column) => column.type === 'formula').map(compileFormulaColumn);
  const { order, cyclic } = formulaEvaluationOrder(compiled);
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const byTitle = new Map(
    columns.map((column) => [column.title.toLocaleLowerCase('pt-BR'), column]),
  );
  if (options.volatileOnly !== true) {
    for (const key of cyclic) set(key, { text: '#REF!', error: '#REF!', computedAt: context.now });
  }
  const volatileKeys = new Set<string>();
  for (const formula of order) {
    const dependsOnVolatile = formula.references.some((reference) => volatileKeys.has(reference));
    if (formula.volatile || dependsOnVolatile) volatileKeys.add(formula.key);
    if (options.volatileOnly === true && !volatileKeys.has(formula.key)) continue;
    if (formula.ast === null) {
      set(formula.key, { text: '#ERROR!', error: '#ERROR!', computedAt: context.now });
      continue;
    }
    const current: ComputedItem = { ...item, values };
    const result = evaluateFormula(formula.ast, {
      today: context.today,
      now: context.now,
      calendar: context.calendar,
      resolve: (reference) => {
        if (reference === 'name') return text(item.name);
        const column = byKey.get(reference) ?? byTitle.get(reference.toLocaleLowerCase('pt-BR'));
        return column === undefined
          ? undefined
          : columnValueToFormula(column, current, context.names);
      },
    });
    set(formula.key, toComputedValue(result, context.now));
  }
  return changes;
}

/** Fórmulas do board que dependem do dia (TODAY/NOW, direta ou indiretamente). */
export function volatileFormulaKeys(columns: readonly ComputedColumn[]): string[] {
  const compiled = columns.filter((column) => column.type === 'formula').map(compileFormulaColumn);
  const { order } = formulaEvaluationOrder(compiled);
  const volatile = new Set<string>();
  for (const formula of order) {
    if (formula.volatile || formula.references.some((reference) => volatile.has(reference)))
      volatile.add(formula.key);
  }
  return [...volatile];
}

/** Valor primitivo de uma coluna de origem para agregação (rollup/espelho). */
export type AggregateSource =
  | { kind: 'number'; value: string }
  | { kind: 'date'; value: string }
  | { kind: 'text'; value: string }
  /** Checkbox (marcado = concluído). */
  | { kind: 'done'; value: boolean }
  | { kind: 'status'; label: string; done: boolean };

export function sourceValue(
  column: ComputedColumn,
  item: ComputedItem,
  names: ComputeContext['names'],
): AggregateSource | null {
  if (column.type === 'status') {
    const labelId = (item.values[column.key] as { labelId?: unknown } | undefined)?.labelId;
    const label = column.labels?.find((entry) => entry.id === labelId);
    return label === undefined
      ? null
      : { kind: 'status', label: label.label, done: label.category === 'done' };
  }
  const formula = columnValueToFormula(column, item, names);
  switch (formula.kind) {
    case 'number':
      return { kind: 'number', value: formula.value };
    case 'date':
      return { kind: 'date', value: formula.value };
    case 'datetime':
      return { kind: 'date', value: formula.value.slice(0, 10) };
    case 'boolean':
      return { kind: 'done', value: formula.value };
    case 'text':
      return { kind: 'text', value: formula.value };
    case 'list':
      return formula.items.length === 0
        ? null
        : {
            kind: 'text',
            value: formula.items
              .map((entry) => ('value' in entry ? String(entry.value) : ''))
              .join(', '),
          };
    default:
      return null;
  }
}

/** Agrega os valores de origem de um rollup ou espelho. */
export function aggregateValues(
  aggregate: RollupAggregate | MirrorAggregate,
  sources: readonly (AggregateSource | null)[],
  now: string,
): ComputedValue | null {
  const present = sources.filter((source): source is AggregateSource => source !== null);
  const numbers = present.flatMap((source) =>
    source.kind === 'number' ? [new Decimal(source.value)] : [],
  );
  const dates = present.flatMap((source) => (source.kind === 'date' ? [source.value] : [])).sort();
  const latestDate = dates.at(-1);
  const number = (value: Decimal | null): ComputedValue | null => {
    if (value === null) return null;
    const n = toStorageDecimal(value);
    return n === null ? { text: '#NUM!', error: '#NUM!', computedAt: now } : { n, computedAt: now };
  };
  switch (aggregate) {
    case 'sum':
      return numbers.length === 0
        ? null
        : number(numbers.reduce((sum, value) => sum.plus(value), new Decimal(0)));
    case 'avg':
      return numbers.length === 0
        ? null
        : number(
            numbers
              .reduce((sum, value) => sum.plus(value), new Decimal(0))
              .dividedBy(numbers.length),
          );
    case 'min':
      if (numbers.length > 0)
        return number(numbers.reduce((min, value) => (value.lessThan(min) ? value : min)));
      return dates[0] === undefined ? null : { d: dates[0], computedAt: now };
    case 'max':
      if (numbers.length > 0)
        return number(numbers.reduce((max, value) => (value.greaterThan(max) ? value : max)));
      return latestDate === undefined ? null : { d: latestDate, computedAt: now };
    case 'earliest':
      return dates[0] === undefined ? null : { d: dates[0], computedAt: now };
    case 'latest':
      return latestDate === undefined ? null : { d: latestDate, computedAt: now };
    case 'count':
      return { n: String(sources.length), computedAt: now };
    case 'count_non_empty':
      return { n: String(present.length), computedAt: now };
    case 'done_percent': {
      if (sources.length === 0) return null;
      const done = present.filter(
        (source) =>
          (source.kind === 'done' && source.value) || (source.kind === 'status' && source.done),
      ).length;
      return number(new Decimal(done).times(100).dividedBy(sources.length));
    }
    case 'list': {
      const parts = present
        .map((source) => {
          if (source.kind === 'status') return source.label;
          if (source.kind === 'done') return source.value ? '✓' : '';
          return source.value;
        })
        .filter((part) => part !== '');
      return parts.length === 0
        ? null
        : { text: parts.join(', ').slice(0, 10_000), computedAt: now };
    }
  }
}

/** Valor numérico decimal de um valor armazenado (para agregações de rodapé). */
export function storedNumber(value: unknown): Decimal | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  return decimalOrNull(record.n);
}
