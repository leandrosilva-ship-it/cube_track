import type { FilterGroup } from '../query.js';
import {
  matchesFilter,
  type ConditionContext,
  type EvaluableColumn,
  type ItemState,
} from './conditions.js';
import { COMPUTED_COLUMN_TYPES, isColumnType } from './registry.js';

/**
 * Obrigatoriedade de colunas (ADR 0039).
 *
 * - `isRequired`: a coluna precisa de valor ao criar o item e não pode ser esvaziada.
 * - `requiredWhen`: obrigatória quando o item casa com a condição (ex.: "OS emitida" = Sim).
 *   É cobrada quando a mudança faz a condição passar a valer ou quando a própria coluna é
 *   esvaziada — itens antigos que já violam a regra não bloqueiam edições não relacionadas.
 *
 * A mesma função roda no cliente (pede o preenchimento antes de salvar) e no servidor (impõe).
 */

export interface RequirementColumn extends EvaluableColumn {
  title: string;
  isRequired: boolean;
  requiredWhen: FilterGroup | null;
}

/** Propriedade que carrega o conteúdo de cada tipo (listas: vazio = lista vazia). */
const CONTENT_PROPERTY: Record<string, string> = {
  text: 'text',
  long_text: 'text',
  number: 'n',
  rating: 'n',
  status: 'labelId',
  dropdown: 'optionIds',
  people: 'personIds',
  tags: 'tags',
  file: 'attachmentIds',
  board_relation: 'itemIds',
  vote: 'userIds',
  date: 'd',
  timeline: 'from',
  week: 'from',
  link: 'url',
  email: 'email',
  phone: 'phone',
  location: 'address',
  color: 'color',
  hour: 'time',
  country: 'code',
};

/** Valor vazio para efeito de obrigatoriedade (checkbox desmarcado conta como vazio). */
export function isEmptyColumnValue(type: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (type === 'checkbox') return entry.checked !== true;
  if (type === 'people') {
    const people = Array.isArray(entry.personIds) ? entry.personIds.length : 0;
    const teams = Array.isArray(entry.teamIds) ? entry.teamIds.length : 0;
    return people + teams === 0;
  }
  const property = CONTENT_PROPERTY[type];
  if (property === undefined) return Object.keys(entry).length === 0;
  const content = entry[property];
  if (Array.isArray(content)) return content.length === 0;
  if (typeof content === 'string') return content.trim() === '';
  return content === undefined || content === null;
}

function isEmptyIn(column: RequirementColumn, state: ItemState): boolean {
  const bound = column.binding?.startsWith('item.') === true ? column.binding.slice(5) : null;
  if (bound !== null) {
    const value = state.fields[bound];
    return value === undefined || value === null || value === '';
  }
  return isEmptyColumnValue(column.type, state.values[column.key]);
}

function applies(column: RequirementColumn): boolean {
  return (
    (column.isRequired || column.requiredWhen !== null) &&
    !(isColumnType(column.type) && COMPUTED_COLUMN_TYPES.has(column.type)) &&
    (column.binding === null || column.binding.startsWith('item.'))
  );
}

function conditionHolds(
  column: RequirementColumn,
  state: ItemState,
  columns: readonly EvaluableColumn[],
  context: ConditionContext,
): boolean {
  return (
    column.requiredWhen !== null && matchesFilter(column.requiredWhen, state, columns, context)
  );
}

/**
 * Colunas obrigatórias sem valor para a mudança `previous → next`.
 *
 * @param previous estado atual (null na criação)
 * @param touched chaves de colunas (ou campos nativos vinculados) alteradas pela mudança
 */
export function missingRequiredColumns(
  columns: readonly RequirementColumn[],
  previous: ItemState | null,
  next: ItemState,
  touched: ReadonlySet<string>,
  context: ConditionContext,
): RequirementColumn[] {
  return columns.filter((column) => {
    if (!applies(column) || !isEmptyIn(column, next)) return false;
    const bound = column.binding?.startsWith('item.') === true ? column.binding.slice(5) : null;
    const cleared = touched.has(column.key) || (bound !== null && touched.has(bound));
    const requiredNow = column.isRequired || conditionHolds(column, next, columns, context);
    if (!requiredNow) return false;
    if (previous === null || cleared) return true;
    // Condição passou a valer com esta mudança (não valia antes).
    return (
      !column.isRequired &&
      column.requiredWhen !== null &&
      !conditionHolds(column, previous, columns, context)
    );
  });
}
