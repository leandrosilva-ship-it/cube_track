import { DATE_TOKENS, type FilterCondition, type FilterOperator } from '@cube-track/shared';

import type { BoardColumn } from '@/lib/api/types';

/**
 * Construtor de filtros avançados: campos filtráveis, operadores por tipo e o tipo de entrada de
 * valor. A AST resultante é a mesma avaliada no servidor (`FilterGroup`, ADR 0005).
 */

export type ValueInput =
  | 'none'
  | 'text'
  | 'number'
  | 'date'
  | 'labels'
  | 'options'
  | 'people'
  | 'groups'
  | 'tags'
  | 'checkbox';

export interface FilterField {
  key: string;
  title: string;
  type: string;
  column: BoardColumn | null;
}

const SELECT_OPERATORS: FilterOperator[] = ['any_of', 'none_of', 'is_empty', 'is_not_empty'];
const TEXT_OPERATORS: FilterOperator[] = [
  'contains',
  'not_contains',
  'is',
  'is_not',
  'is_empty',
  'is_not_empty',
];
const NUMBER_OPERATORS: FilterOperator[] = [
  'is',
  'is_not',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_empty',
  'is_not_empty',
];
const DATE_OPERATORS: FilterOperator[] = [
  'is',
  'before',
  'after',
  'overdue',
  'is_empty',
  'is_not_empty',
];

const NUMERIC_TYPES = new Set([
  'number',
  'rating',
  'time_tracking',
  'formula',
  'mirror',
  'rollup',
  'progress',
  'auto_id',
]);
const DATE_TYPES = new Set(['date', 'timeline', 'week']);
const UNFILTERABLE = new Set([
  'button',
  'dependency',
  'file',
  'vote',
  'item_id',
  'creation_log',
  'last_updated',
]);

/** Campos que o construtor oferece: nome, grupo, datas de criação/atualização e colunas. */
export function filterFields(
  columns: readonly BoardColumn[],
  titles: { name: string; group: string; createdAt: string; updatedAt: string },
): FilterField[] {
  return [
    { key: 'name', title: titles.name, type: 'text', column: null },
    { key: 'group_id', title: titles.group, type: 'group', column: null },
    ...columns
      .filter((column) => !UNFILTERABLE.has(column.type) && !column.isHidden)
      .map((column) => ({ key: column.key, title: column.title, type: column.type, column })),
    { key: 'created_at', title: titles.createdAt, type: 'date', column: null },
    { key: 'updated_at', title: titles.updatedAt, type: 'date', column: null },
  ];
}

export function operatorsFor(field: FilterField): FilterOperator[] {
  const { type } = field;
  if (type === 'group') return ['any_of', 'none_of'];
  if (type === 'status' || type === 'dropdown' || type === 'people' || type === 'tags')
    return SELECT_OPERATORS;
  if (type === 'checkbox') return ['is'];
  if (type === 'board_relation') return ['is_empty', 'is_not_empty'];
  if (NUMERIC_TYPES.has(type)) return NUMBER_OPERATORS;
  if (DATE_TYPES.has(type)) return DATE_OPERATORS;
  return TEXT_OPERATORS;
}

export function valueInputFor(field: FilterField, operator: FilterOperator): ValueInput {
  if (operator === 'is_empty' || operator === 'is_not_empty' || operator === 'overdue')
    return 'none';
  switch (field.type) {
    case 'group':
      return 'groups';
    case 'status':
      return 'labels';
    case 'dropdown':
      return 'options';
    case 'people':
      return 'people';
    case 'checkbox':
      return 'checkbox';
    case 'tags':
      return 'tags';
    default:
      if (NUMERIC_TYPES.has(field.type)) return 'number';
      if (DATE_TYPES.has(field.type)) return 'date';
      return 'text';
  }
}

/** Tokens relativos de data oferecidos no construtor ("hoje", "esta semana"…). */
export const DATE_TOKEN_OPTIONS = DATE_TOKENS;

/** Condição inicial ao escolher um campo (primeiro operador, sem valor). */
export function initialCondition(field: FilterField): FilterCondition {
  const operator = operatorsFor(field)[0] ?? 'is_not_empty';
  return field.type === 'checkbox'
    ? { field: field.key, operator, value: true }
    : { field: field.key, operator };
}

/** Ajusta o valor ao trocar o operador (mantém listas para any/none, escalar para os demais). */
export function changeOperator(
  condition: FilterCondition,
  field: FilterField,
  operator: FilterOperator,
): FilterCondition {
  const input = valueInputFor(field, operator);
  if (input === 'none') return { field: condition.field, operator };
  const listInput =
    input === 'labels' ||
    input === 'options' ||
    input === 'people' ||
    input === 'groups' ||
    input === 'tags';
  const current = condition.value;
  if (listInput)
    return {
      field: condition.field,
      operator,
      value: Array.isArray(current)
        ? current
        : current === undefined || current === null
          ? []
          : [current],
    };
  if (Array.isArray(current))
    return {
      field: condition.field,
      operator,
      ...(current[0] === undefined ? {} : { value: current[0] }),
    };
  return { field: condition.field, operator, ...(current === undefined ? {} : { value: current }) };
}

/** Atalhos de filtro rápido: "meus itens", "atrasados", "vence esta semana". */
export function quickFilter(
  kind: 'mine' | 'overdue' | 'this_week',
  columns: readonly BoardColumn[],
  statusDateKey: string | null,
): FilterCondition[] {
  if (kind === 'mine')
    return columns
      .filter((column) => column.type === 'people')
      .slice(0, 1)
      .map((column) => ({ field: column.key, operator: 'any_of', value: ['me'] }));
  if (statusDateKey === null) return [];
  return kind === 'overdue'
    ? [{ field: statusDateKey, operator: 'overdue' }]
    : [{ field: statusDateKey, operator: 'is', value: 'this_week' }];
}

/** Coluna de data principal (prazo): vinculada ao término planejado ou a primeira coluna de data. */
export function dueDateColumn(columns: readonly BoardColumn[]): BoardColumn | null {
  return (
    columns.find(
      (column) => column.type === 'date' && column.binding === 'item.planned_end_date',
    ) ??
    columns.find((column) => column.type === 'date') ??
    null
  );
}
