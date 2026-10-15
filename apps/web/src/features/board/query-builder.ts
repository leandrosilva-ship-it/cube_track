import { isFilterGroup, type FilterCondition, type FilterGroup } from '@cube-track/shared';

import type { BoardColumn } from '@/lib/api/types';
import type { ItemListParams } from '@/lib/query/keys';

/**
 * Converte o estado da barra de ferramentas em parâmetros da API (`search`, `filter` AST em JSON e
 * `sort`), avaliados no servidor com as mesmas regras de permissão (colunas ocultas não podem ser
 * usadas). A busca cobre o nome e os textos indexados do item.
 */
export function buildItemQuery(
  params: ItemListParams,
  columns: readonly BoardColumn[],
): { filter?: string; sort?: string; search?: string; parentItemId?: string } {
  const conditions: (FilterCondition | FilterGroup)[] = [];
  if (params.personId !== undefined) {
    const people = columns.filter((column) => column.type === 'people');
    if (people.length === 1 && people[0] !== undefined) {
      conditions.push({ field: people[0].key, operator: 'any_of', value: [params.personId] });
    } else if (people.length > 1) {
      conditions.push({
        op: 'or',
        conditions: people.map((column) => ({
          field: column.key,
          operator: 'any_of',
          value: [params.personId ?? ''],
        })),
      });
    }
  }
  const statusColumn = columns.find((column) => column.type === 'status');
  if ((params.statusLabelIds?.length ?? 0) > 0 && statusColumn !== undefined) {
    conditions.push({
      field: statusColumn.key,
      operator: 'any_of',
      value: [...(params.statusLabelIds ?? [])],
    });
  }
  const advanced = params.filter === undefined ? null : pruneFilter(params.filter);
  if (advanced !== null) conditions.push(advanced);
  const search = params.search?.trim() ?? '';
  return {
    ...(conditions.length === 0
      ? {}
      : { filter: JSON.stringify({ op: 'and', conditions } satisfies FilterGroup) }),
    ...(params.sort === undefined ? {} : { sort: params.sort }),
    ...(search === '' ? {} : { search }),
    ...(params.parentItemId === undefined ? {} : { parentItemId: params.parentItemId }),
  };
}

const NO_VALUE_OPERATORS = new Set(['is_empty', 'is_not_empty', 'overdue']);

/** Condição completa o bastante para enviar (operadores com valor exigem valor). */
export function isCompleteCondition(condition: FilterCondition): boolean {
  if (NO_VALUE_OPERATORS.has(condition.operator)) return true;
  const value = condition.value;
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value !== 'string' || value.trim() !== '';
}

/** Remove condições incompletas e grupos vazios (o construtor permite rascunhos). */
export function pruneFilter(group: FilterGroup): FilterGroup | null {
  const conditions = group.conditions.flatMap((node): (FilterCondition | FilterGroup)[] => {
    if (isFilterGroup(node)) {
      const pruned = pruneFilter(node);
      return pruned === null ? [] : [pruned];
    }
    return isCompleteCondition(node) ? [node] : [];
  });
  return conditions.length === 0 ? null : { op: group.op, conditions };
}

export function countConditions(group: FilterGroup | undefined): number {
  if (group === undefined) return 0;
  return group.conditions.reduce(
    (sum, node) => sum + (isFilterGroup(node) ? countConditions(node) : 1),
    0,
  );
}

/** Quantidade de filtros ativos (badge da barra de ferramentas). */
export function activeFilterCount(params: ItemListParams): number {
  const advanced = params.filter === undefined ? null : pruneFilter(params.filter);
  return (
    ((params.search?.trim() ?? '') === '' ? 0 : 1) +
    (params.personId === undefined ? 0 : 1) +
    ((params.statusLabelIds?.length ?? 0) > 0 ? 1 : 0) +
    (advanced === null ? 0 : countConditions(advanced))
  );
}
