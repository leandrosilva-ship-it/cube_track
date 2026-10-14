import type { BoardColumn } from '@/lib/api/types';
import type { ItemListParams } from '@/lib/query/keys';

interface Condition {
  field: string;
  operator: string;
  value?: unknown;
}
interface Group {
  op: 'and' | 'or';
  conditions: (Condition | Group)[];
}

/**
 * Converte o estado da barra de ferramentas em parâmetros da API (`filter` AST em JSON e `sort`),
 * avaliados no servidor com as mesmas regras de permissão (colunas ocultas não podem ser usadas).
 */
export function buildItemQuery(
  params: ItemListParams,
  columns: readonly BoardColumn[],
): { filter?: string; sort?: string } {
  const conditions: (Condition | Group)[] = [];
  const search = params.search?.trim() ?? '';
  if (search !== '') conditions.push({ field: 'name', operator: 'contains', value: search });
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
          value: [params.personId],
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
  return {
    ...(conditions.length === 0
      ? {}
      : { filter: JSON.stringify({ op: 'and', conditions } satisfies Group) }),
    ...(params.sort === undefined ? {} : { sort: params.sort }),
  };
}

/** Quantidade de filtros ativos (badge da barra de ferramentas). */
export function activeFilterCount(params: ItemListParams): number {
  return (
    ((params.search?.trim() ?? '') === '' ? 0 : 1) +
    (params.personId === undefined ? 0 : 1) +
    ((params.statusLabelIds?.length ?? 0) > 0 ? 1 : 0)
  );
}
