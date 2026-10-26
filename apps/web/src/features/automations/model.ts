import {
  READ_ONLY_COLUMN_TYPES,
  type AutomationActionSpec,
  type AutomationTriggerSpec,
  type ColumnType,
} from '@cube-track/shared';

import type { BoardColumn } from '@/lib/api/types';

/** Chaves de `automations.summary.*` (pt-BR/en/es) usadas pelos resumos de gatilho/ação. */
export type AutomationSummaryKey =
  | 'summary.trigger.itemCreatedAny'
  | 'summary.trigger.itemCreatedGroup'
  | 'summary.trigger.columnChanged'
  | 'summary.trigger.buttonClicked'
  | 'summary.trigger.dateOn'
  | 'summary.trigger.dateBefore'
  | 'summary.trigger.dateAfter'
  | 'summary.action.moveToGroup'
  | 'summary.action.setColumn'
  | 'summary.action.notify';

/** Mensagem i18n diferida: a UI resolve `key`/`values` com `useTranslations('automations')`. */
export interface I18nMessage {
  key: AutomationSummaryKey;
  values?: Record<string, string | number>;
}

/** Campos nativos de data graváveis por automações e aceitos pelo gatilho `date_arrives`. */
export const NATIVE_DATE_FIELDS = [
  'plannedStartDate',
  'plannedEndDate',
  'replannedStartDate',
  'replannedEndDate',
  'actualStartDate',
  'actualEndDate',
] as const;
export type NativeDateField = (typeof NATIVE_DATE_FIELDS)[number];

export function statusColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => column.type === 'status');
}
export function buttonColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => column.type === 'button');
}
export function dateColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => column.type === 'date');
}
export function peopleColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => column.type === 'people');
}
/** Colunas em que uma ação `set_column_value` pode gravar (sem calculadas nem vinculadas). */
export function writableColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter(
    (column) => column.binding === null && !READ_ONLY_COLUMN_TYPES.has(column.type as ColumnType),
  );
}

function columnTitle(columns: readonly { key: string; title: string }[], key: string): string {
  return columns.find((column) => column.key === key)?.title ?? key;
}

function groupName(groups: readonly { id: string; name: string }[], id: string): string {
  return groups.find((group) => group.id === id)?.name ?? id;
}

/** Resumo de uma linha do gatilho para a lista de automações (resolvido via i18n pela UI). */
export function triggerSummary(
  trigger: AutomationTriggerSpec,
  columns: readonly { key: string; title: string }[],
  groups: readonly { id: string; name: string }[],
): I18nMessage {
  switch (trigger.type) {
    case 'item_created':
      return trigger.config.groupId === undefined
        ? { key: 'summary.trigger.itemCreatedAny' }
        : {
            key: 'summary.trigger.itemCreatedGroup',
            values: { group: groupName(groups, trigger.config.groupId) },
          };
    case 'column_value_changed':
      return {
        key: 'summary.trigger.columnChanged',
        values: { column: columnTitle(columns, trigger.config.columnKey) },
      };
    case 'button_clicked':
      return {
        key: 'summary.trigger.buttonClicked',
        values: { column: columnTitle(columns, trigger.config.columnKey) },
      };
    case 'date_arrives': {
      const column = columnTitle(columns, trigger.config.columnKey);
      const days = Math.abs(trigger.config.offsetDays);
      if (trigger.config.offsetDays === 0) return { key: 'summary.trigger.dateOn', values: { column } };
      return {
        key:
          trigger.config.offsetDays < 0 ? 'summary.trigger.dateBefore' : 'summary.trigger.dateAfter',
        values: { column, days },
      };
    }
  }
}

/** Resumo de uma ação para a lista de automações (resolvido via i18n pela UI). */
export function actionSummary(
  action: AutomationActionSpec,
  columns: readonly { key: string; title: string }[],
  groups: readonly { id: string; name: string }[],
): I18nMessage {
  switch (action.type) {
    case 'move_to_group':
      return { key: 'summary.action.moveToGroup', values: { group: groupName(groups, action.config.groupId) } };
    case 'set_column_value': {
      const key = 'columnKey' in action.config ? action.config.columnKey : action.config.binding;
      return { key: 'summary.action.setColumn', values: { column: columnTitle(columns, key) } };
    }
    case 'notify':
      return { key: 'summary.action.notify' };
  }
}

export interface AutomationInputBody {
  name: string;
  description: string | null;
  trigger: { type: string; config: Record<string, unknown> };
  conditions: Record<string, unknown> | null;
  actions: { type: string; config: Record<string, unknown> }[];
  isEnabled: boolean;
}

export type ConditionOperator =
  | 'is'
  | 'is_not'
  | 'any_of'
  | 'none_of'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty';

export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
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
  'is_empty',
  'is_not_empty',
];

/** Uma linha do construtor simplificado de condições (E lógico apenas — v1). */
export interface ConditionRow {
  field: string;
  operator: ConditionOperator;
  value: string;
}

const VALUELESS_OPERATORS = new Set<ConditionOperator>(['is_empty', 'is_not_empty']);

/** Monta `conditions` no formato aceito pela API (`{op:'and', conditions:[...]}` ou `null`). */
export function buildConditions(rows: readonly ConditionRow[]): Record<string, unknown> | null {
  const valid = rows.filter((row) => row.field !== '');
  if (valid.length === 0) return null;
  return {
    op: 'and',
    conditions: valid.map((row) => ({
      field: row.field,
      operator: row.operator,
      ...(VALUELESS_OPERATORS.has(row.operator) ? {} : { value: row.value }),
    })),
  };
}

/** Lê `conditions` vindo da API de volta para linhas editáveis (grupos aninhados viram texto fixo). */
export function conditionsToRows(conditions: unknown): ConditionRow[] {
  if (conditions === null || conditions === undefined || typeof conditions !== 'object') return [];
  const entries = Array.isArray((conditions as { conditions?: unknown }).conditions)
    ? ((conditions as { conditions: unknown[] }).conditions as Record<string, unknown>[])
    : [];
  return entries
    .filter((entry) => typeof entry.operator === 'string')
    .map((entry) => ({
      field: typeof entry.field === 'string' ? entry.field : (entry.columnKey as string | undefined) ?? '',
      operator: entry.operator as ConditionOperator,
      value:
        typeof entry.value === 'string' ||
        typeof entry.value === 'number' ||
        typeof entry.value === 'boolean'
          ? String(entry.value)
          : '',
    }));
}
