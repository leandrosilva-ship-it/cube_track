import { Decimal } from '../decimal.js';

import { shiftDays, isoWeekday } from '../business-days.js';
import { isFilterGroup, type FilterCondition, type FilterGroup } from '../query.js';

/**
 * Avaliação local da AST de filtros (packages/shared/query.ts) sobre o estado de um item.
 *
 * Espelha a semântica do compilador SQL da API (`item-query.ts`): é usada para a obrigatoriedade
 * condicional (servidor e cliente avaliam a mesma regra) e para o cliente decidir se um item alterado
 * em tempo real continua casando com o filtro da Tabela.
 */

/** Períodos aceitos como valor de filtros de data (resolvidos no fuso do tenant). */
export const DATE_TOKENS = [
  'today',
  'tomorrow',
  'yesterday',
  'this_week',
  'last_week',
  'next_week',
  'this_month',
  'last_month',
  'next_month',
  'next_7_days',
  'last_7_days',
] as const;
export type DateToken = (typeof DATE_TOKENS)[number];

export function isDateToken(value: unknown): value is DateToken {
  return typeof value === 'string' && (DATE_TOKENS as readonly string[]).includes(value);
}

/** Valor especial de filtros de pessoas: o usuário atual. */
export const CURRENT_USER_TOKEN = 'me';

function monthBounds(today: string, offset: number): { from: string; to: string } {
  const [year = 0, month = 1] = today.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Intervalo fechado `[from, to]` de um período relativo a `today` (semana de segunda a domingo). */
export function resolveDateToken(token: DateToken, today: string): { from: string; to: string } {
  const weekStart = shiftDays(today, 1 - isoWeekday(today));
  switch (token) {
    case 'today':
      return { from: today, to: today };
    case 'tomorrow': {
      const day = shiftDays(today, 1);
      return { from: day, to: day };
    }
    case 'yesterday': {
      const day = shiftDays(today, -1);
      return { from: day, to: day };
    }
    case 'this_week':
      return { from: weekStart, to: shiftDays(weekStart, 6) };
    case 'last_week':
      return { from: shiftDays(weekStart, -7), to: shiftDays(weekStart, -1) };
    case 'next_week':
      return { from: shiftDays(weekStart, 7), to: shiftDays(weekStart, 13) };
    case 'this_month':
      return monthBounds(today, 0);
    case 'last_month':
      return monthBounds(today, -1);
    case 'next_month':
      return monthBounds(today, 1);
    case 'next_7_days':
      return { from: today, to: shiftDays(today, 6) };
    case 'last_7_days':
      return { from: shiftDays(today, -6), to: today };
  }
}

/** Coluna mínima para avaliar condições (rótulos trazem a categoria para "concluído"). */
export interface EvaluableColumn {
  key: string;
  type: string;
  binding: string | null;
}

/** Estado do item avaliado (valores customizados + campos nativos em snake_case). */
export interface ItemState {
  name: string;
  groupId: string;
  values: Readonly<Record<string, unknown>>;
  /** Campos nativos: `planned_end_date`, `progress`, `created_at`… (string ISO ou decimal). */
  fields: Readonly<Partial<Record<string, string | null>>>;
  /** Item concluído (status principal em categoria "done"); usado por `overdue`. */
  completed: boolean;
}

export interface ConditionContext {
  currentUserId: string;
  currentUserTeamIds?: readonly string[];
  /** Hoje (AAAA-MM-DD) no fuso do tenant. */
  today: string;
}

type Scalar = string | number | boolean;

const NUMERIC_TYPES = new Set([
  'number',
  'rating',
  'time_tracking',
  'auto_id',
  'formula',
  'mirror',
  'progress',
  'rollup',
]);
const DATE_TYPES = new Set(['date', 'timeline', 'week']);
const LIST_PROPERTY: Record<string, string> = {
  dropdown: 'optionIds',
  people: 'personIds',
  tags: 'tags',
  board_relation: 'itemIds',
  file: 'attachmentIds',
};
const NATIVE_TYPES: Record<string, 'text' | 'uuid' | 'date' | 'numeric' | 'timestamp'> = {
  name: 'text',
  group_id: 'uuid',
  created_at: 'timestamp',
  updated_at: 'timestamp',
  planned_start_date: 'date',
  planned_end_date: 'date',
  replanned_start_date: 'date',
  replanned_end_date: 'date',
  actual_start_date: 'date',
  actual_end_date: 'date',
  progress: 'numeric',
};

function scalars(value: FilterCondition['value']): Scalar[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asDecimal(value: unknown): Decimal | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Decimal(value);
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))
    return new Decimal(value.trim());
  return null;
}

/** Texto plano comparável de um valor de coluna textual. */
function textOf(type: string, value: Record<string, unknown>): string | null {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const entry = value[key];
      if (typeof entry === 'string' && entry !== '') return entry;
    }
    return null;
  };
  switch (type) {
    case 'link':
      return pick('text', 'url');
    case 'email':
      return pick('email');
    case 'phone':
      return pick('phone');
    case 'country':
      return pick('code');
    case 'color':
      return pick('color');
    case 'hour':
      return pick('time');
    case 'location':
      return pick('address');
    case 'auto_id':
      return pick('text');
    default:
      return pick('text');
  }
}

function compareOrdered<T>(
  actual: T | null,
  condition: FilterCondition,
  parse: (value: Scalar) => T | null,
  cmp: (a: T, b: T) => number,
): boolean {
  const { operator } = condition;
  if (operator === 'is_empty') return actual === null;
  if (operator === 'is_not_empty') return actual !== null;
  const values = scalars(condition.value)
    .map(parse)
    .filter((value): value is T => value !== null);
  const first = values[0];
  if (operator === 'is_not')
    return actual === null || first === undefined || cmp(actual, first) !== 0;
  if (operator === 'none_of')
    return actual === null || values.every((value) => cmp(actual, value) !== 0);
  if (actual === null) return false;
  switch (operator) {
    case 'is':
      return first !== undefined && cmp(actual, first) === 0;
    case 'any_of':
      return values.some((value) => cmp(actual, value) === 0);
    case 'gt':
    case 'after':
      return first !== undefined && cmp(actual, first) > 0;
    case 'gte':
      return first !== undefined && cmp(actual, first) >= 0;
    case 'lt':
    case 'before':
      return first !== undefined && cmp(actual, first) < 0;
    case 'lte':
      return first !== undefined && cmp(actual, first) <= 0;
    case 'between': {
      const [low, high] = values;
      return (
        low !== undefined && high !== undefined && cmp(actual, low) >= 0 && cmp(actual, high) <= 0
      );
    }
    default:
      return false;
  }
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function evaluateDate(
  actual: string | null,
  condition: FilterCondition,
  item: ItemState,
  context: ConditionContext,
): boolean {
  if (condition.operator === 'overdue')
    return actual !== null && actual < context.today && !item.completed;
  const first = scalars(condition.value)[0];
  if (isDateToken(first)) {
    const range = resolveDateToken(first, context.today);
    const inside = actual !== null && actual >= range.from && actual <= range.to;
    switch (condition.operator) {
      case 'is':
      case 'any_of':
      case 'between':
        return inside;
      case 'is_not':
      case 'none_of':
        return !inside;
      case 'before':
      case 'lt':
        return actual !== null && actual < range.from;
      case 'lte':
        return actual !== null && actual <= range.to;
      case 'after':
      case 'gt':
        return actual !== null && actual > range.to;
      case 'gte':
        return actual !== null && actual >= range.from;
      default:
        break;
    }
  }
  return compareOrdered(
    actual,
    condition,
    (value) =>
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null,
    compareStrings,
  );
}

function evaluateText(actual: string | null, condition: FilterCondition): boolean {
  const normalized = actual?.toLocaleLowerCase('pt-BR') ?? null;
  const values = scalars(condition.value).map((value) => String(value).toLocaleLowerCase('pt-BR'));
  const first = values[0] ?? '';
  switch (condition.operator) {
    case 'contains':
      return normalized?.includes(first) === true;
    case 'not_contains':
      return normalized?.includes(first) !== true;
    default:
      return compareOrdered(
        normalized === '' ? null : normalized,
        { ...condition, value: values },
        (value) => String(value),
        compareStrings,
      );
  }
}

function evaluateList(
  ids: readonly string[],
  condition: FilterCondition,
  context: ConditionContext,
  isPeople: boolean,
): boolean {
  const wanted = scalars(condition.value).flatMap((value) =>
    isPeople && value === CURRENT_USER_TOKEN
      ? [context.currentUserId, ...(context.currentUserTeamIds ?? [])]
      : [String(value)],
  );
  const intersects = wanted.some((value) => ids.includes(value));
  switch (condition.operator) {
    case 'is_empty':
      return ids.length === 0;
    case 'is_not_empty':
      return ids.length > 0;
    case 'is':
    case 'any_of':
    case 'contains':
      return intersects;
    case 'is_not':
    case 'none_of':
    case 'not_contains':
      return !intersects;
    default:
      return false;
  }
}

function evaluateColumn(
  column: EvaluableColumn,
  raw: unknown,
  condition: FilterCondition,
  item: ItemState,
  context: ConditionContext,
): boolean {
  const value = record(raw);
  const { type } = column;
  if (type === 'status') {
    const labelId = typeof value?.labelId === 'string' ? value.labelId : null;
    return compareOrdered(labelId, condition, (entry) => String(entry), compareStrings);
  }
  if (type === 'checkbox') {
    const checked = value?.checked === true;
    if (condition.operator === 'is_empty') return !checked;
    if (condition.operator === 'is_not_empty') return checked;
    const first = scalars(condition.value)[0];
    const expected = first === true || first === 'true';
    return condition.operator === 'is_not' ? checked !== expected : checked === expected;
  }
  const listProperty = LIST_PROPERTY[type];
  if (listProperty !== undefined) {
    const list = value?.[listProperty];
    const teams = type === 'people' ? value?.teamIds : undefined;
    const ids = [
      ...(Array.isArray(list) ? list.map(String) : []),
      ...(Array.isArray(teams) ? teams.map(String) : []),
    ];
    return evaluateList(ids, condition, context, type === 'people');
  }
  if (DATE_TYPES.has(type)) {
    const date =
      typeof value?.d === 'string' ? value.d : typeof value?.from === 'string' ? value.from : null;
    return evaluateDate(date, condition, item, context);
  }
  if (NUMERIC_TYPES.has(type)) {
    const computedDate = typeof value?.d === 'string' ? value.d : null;
    if (computedDate !== null && value?.n === undefined)
      return evaluateDate(computedDate, condition, item, context);
    const numeric = asDecimal(type === 'auto_id' ? value?.seq : value?.n);
    if (
      numeric === null &&
      typeof value?.text === 'string' &&
      ['contains', 'not_contains'].includes(condition.operator)
    )
      return evaluateText(value.text, condition);
    return compareOrdered(numeric, condition, asDecimal, (a, b) => a.comparedTo(b));
  }
  return evaluateText(value === null ? null : textOf(type, value), condition);
}

function evaluateNative(
  field: string,
  condition: FilterCondition,
  item: ItemState,
  context: ConditionContext,
): boolean {
  const kind = NATIVE_TYPES[field];
  const actual =
    field === 'name'
      ? item.name
      : field === 'group_id'
        ? item.groupId
        : (item.fields[field] ?? null);
  switch (kind) {
    case 'date':
      return evaluateDate(actual, condition, item, context);
    case 'timestamp':
      return evaluateDate(actual === null ? null : actual.slice(0, 10), condition, item, context);
    case 'numeric':
      return compareOrdered(asDecimal(actual), condition, asDecimal, (a, b) => a.comparedTo(b));
    case 'uuid':
      return compareOrdered(actual, condition, (value) => String(value), compareStrings);
    default:
      return evaluateText(actual, condition);
  }
}

/** Campo nativo correspondente a uma coluna vinculada (`item.planned_end_date` → `planned_end_date`). */
function boundField(column: EvaluableColumn): string | null {
  return column.binding?.startsWith('item.') === true ? column.binding.slice('item.'.length) : null;
}

/**
 * O item casa com o filtro? Campos desconhecidos tornam a condição falsa (o servidor rejeita esses
 * filtros antes; aqui a avaliação é tolerante para não travar a interface).
 */
export function matchesFilter(
  filter: FilterGroup,
  item: ItemState,
  columns: readonly EvaluableColumn[],
  context: ConditionContext,
): boolean {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const visit = (node: FilterCondition | FilterGroup): boolean => {
    if (isFilterGroup(node)) {
      if (node.conditions.length === 0) return true;
      return node.op === 'and' ? node.conditions.every(visit) : node.conditions.some(visit);
    }
    if (node.field in NATIVE_TYPES) return evaluateNative(node.field, node, item, context);
    const column = byKey.get(node.field);
    if (column === undefined) return false;
    const bound = boundField(column);
    if (bound !== null) return evaluateNative(bound, node, item, context);
    return evaluateColumn(column, item.values[column.key], node, item, context);
  };
  return visit(filter);
}
