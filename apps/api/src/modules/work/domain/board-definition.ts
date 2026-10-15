import {
  FilterGroupSchema,
  type ComputedColumn,
  type ComputedItem,
  type FilterGroup,
  type ItemState,
  type RequirementColumn,
} from '@cube-track/shared';

import type { ItemRecord } from './item.js';

export interface StatusLabelDefinition {
  id: string;
  label: string;
  color: string;
  category: 'not_started' | 'in_progress' | 'done' | 'stuck';
  position: string;
}

export interface DropdownOptionDefinition {
  id: string;
  label: string;
  color: string | null;
  position: string;
}

/** Coluna com tudo o que as regras de escrita precisam (tipo, configurações, rótulos, regras). */
export interface ColumnDefinition {
  id: string;
  key: string;
  type: string;
  title: string;
  description: string | null;
  binding: string | null;
  settings: Record<string, unknown>;
  isRequired: boolean;
  requiredWhen: FilterGroup | null;
  defaultValue: Record<string, unknown> | null;
  position: string;
  width: number | null;
  labels: StatusLabelDefinition[];
  options: DropdownOptionDefinition[];
}

export interface BoardDefinition {
  boardId: string;
  workspaceId: string;
  settings: Record<string, unknown>;
  columns: ColumnDefinition[];
}

/** Lê `required_when` armazenado; regras inválidas são ignoradas (não travam a escrita). */
export function parseRequiredWhen(raw: unknown): FilterGroup | null {
  if (raw === null || raw === undefined) return null;
  const parsed = FilterGroupSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Coluna de status principal (conclusão do item, filtro "atrasados", progresso por subitens):
 * `settings.statusColumnKey` do board → coluna `c_status` → primeira coluna de status.
 */
export function mainStatusColumn(definition: BoardDefinition): ColumnDefinition | null {
  const statuses = definition.columns.filter((column) => column.type === 'status');
  const configured = definition.settings.statusColumnKey;
  return (
    statuses.find((column) => column.key === configured) ??
    statuses.find((column) => column.key === 'c_status') ??
    statuses[0] ??
    null
  );
}

/** O item está concluído (status principal em rótulo de categoria "done")? */
export function isItemDone(
  definition: BoardDefinition,
  values: Readonly<Record<string, unknown>>,
): boolean {
  const status = mainStatusColumn(definition);
  if (status === null) return false;
  const labelId = (values[status.key] as { labelId?: unknown } | undefined)?.labelId;
  return status.labels.some((label) => label.id === labelId && label.category === 'done');
}

const NATIVE_STATE_FIELDS = {
  planned_start_date: 'plannedStartDate',
  planned_end_date: 'plannedEndDate',
  replanned_start_date: 'replannedStartDate',
  replanned_end_date: 'replannedEndDate',
  actual_start_date: 'actualStartDate',
  actual_end_date: 'actualEndDate',
  progress: 'progress',
} as const;

export type ItemSnapshotLike = Pick<
  ItemRecord,
  | 'name'
  | 'groupId'
  | 'values'
  | 'plannedStartDate'
  | 'plannedEndDate'
  | 'replannedStartDate'
  | 'replannedEndDate'
  | 'actualStartDate'
  | 'actualEndDate'
  | 'progress'
> & { createdAt?: Date; updatedAt?: Date };

/** Estado do item para avaliar condições (obrigatoriedade condicional, filtros locais). */
export function toItemState(definition: BoardDefinition, item: ItemSnapshotLike): ItemState {
  const fields: Record<string, string | null> = {};
  for (const [field, property] of Object.entries(NATIVE_STATE_FIELDS))
    fields[field] = item[property];
  if (item.createdAt !== undefined) fields.created_at = item.createdAt.toISOString();
  if (item.updatedAt !== undefined) fields.updated_at = item.updatedAt.toISOString();
  return {
    name: item.name,
    groupId: item.groupId,
    values: item.values,
    fields,
    completed: isItemDone(definition, item.values),
  };
}

export function toComputedItem(
  item: ItemSnapshotLike & { id: string; createdAt: Date; updatedAt: Date },
): ComputedItem {
  const fields: Record<string, string | null> = {};
  for (const [field, property] of Object.entries(NATIVE_STATE_FIELDS))
    fields[field] = item[property];
  return {
    id: item.id,
    name: item.name,
    values: item.values,
    fields,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toComputedColumns(definition: BoardDefinition): ComputedColumn[] {
  return definition.columns.map((column) => ({
    key: column.key,
    type: column.type,
    title: column.title,
    binding: column.binding,
    settings: column.settings,
    labels: column.labels,
    options: column.options,
  }));
}

export function toRequirementColumns(definition: BoardDefinition): RequirementColumn[] {
  return definition.columns.map((column) => ({
    key: column.key,
    type: column.type,
    title: column.title,
    binding: column.binding,
    isRequired: column.isRequired,
    requiredWhen: column.requiredWhen,
  }));
}

/** Hoje (AAAA-MM-DD) no fuso do tenant. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
