import { z } from 'zod';

/**
 * Filtros e ordenação genéricos (AST tipada, ADR 0005). Reutilizados por views, API REST/GraphQL,
 * automações e dashboards. Campos são chaves de coluna customizada ou campos nativos do item.
 */

export const NATIVE_ITEM_FIELDS = [
  'name',
  'group_id',
  'position',
  'created_at',
  'updated_at',
  'planned_start_date',
  'planned_end_date',
  'replanned_start_date',
  'replanned_end_date',
  'actual_start_date',
  'actual_end_date',
  'progress',
] as const;
export type NativeItemField = (typeof NATIVE_ITEM_FIELDS)[number];

export const FILTER_OPERATORS = [
  'is',
  'is_not',
  'any_of',
  'none_of',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'before',
  'after',
  'is_empty',
  'is_not_empty',
  /** Datas: anterior a hoje e item não concluído. */
  'overdue',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FilterScalarSchema = z.union([z.string().max(1_000), z.number(), z.boolean()]);

export const FilterConditionSchema = z
  .object({
    field: z.string().min(1).max(64),
    operator: z.enum(FILTER_OPERATORS),
    value: z.union([FilterScalarSchema, z.array(FilterScalarSchema).max(200), z.null()]).optional(),
  })
  .strict();
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export interface FilterGroup {
  op: 'and' | 'or';
  conditions: (FilterCondition | FilterGroup)[];
}

export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z
    .object({
      op: z.enum(['and', 'or']),
      conditions: z.array(z.union([FilterConditionSchema, FilterGroupSchema])).max(50),
    })
    .strict(),
);

export function isFilterGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return 'op' in node;
}

/** Todos os campos referenciados por um filtro (para checagem de permissão de coluna). */
export function filterFields(filter: FilterGroup): string[] {
  const fields = new Set<string>();
  const visit = (node: FilterCondition | FilterGroup) => {
    if (isFilterGroup(node)) node.conditions.forEach(visit);
    else fields.add(node.field);
  };
  visit(filter);
  return [...fields];
}

/** Profundidade máxima do filtro (proteção contra abuso). */
export function filterDepth(filter: FilterGroup): number {
  return (
    1 +
    Math.max(0, ...filter.conditions.map((node) => (isFilterGroup(node) ? filterDepth(node) : 0)))
  );
}

export interface SortTerm {
  field: string;
  direction: 'asc' | 'desc';
}

/** Interpreta `sort=c_ust:desc,name:asc` (máximo 3 termos). */
export function parseSort(raw: string | undefined): SortTerm[] {
  if (raw === undefined || raw.trim() === '') return [];
  const terms = raw.split(',').map((part): SortTerm => {
    const [field, direction = 'asc'] = part.trim().split(':');
    if (
      field === undefined ||
      !/^[a-z][a-z0-9_]{0,63}$/.test(field) ||
      (direction !== 'asc' && direction !== 'desc')
    ) {
      throw new Error(`Termo de ordenação inválido: "${part}"`);
    }
    return { field, direction };
  });
  if (terms.length > 3) throw new Error('Máximo de 3 termos de ordenação');
  return terms;
}

export function sortSignature(terms: readonly SortTerm[]): string {
  return terms.map((term) => `${term.field}:${term.direction}`).join(',') || 'position:asc';
}
