import type { ColumnType } from '@cube-track/shared';

/** Campos nativos editáveis do item e o binding de coluna correspondente. */
export const NATIVE_DATE_FIELDS = {
  plannedStartDate: 'item.planned_start_date',
  plannedEndDate: 'item.planned_end_date',
  replannedStartDate: 'item.replanned_start_date',
  replannedEndDate: 'item.replanned_end_date',
  actualStartDate: 'item.actual_start_date',
  actualEndDate: 'item.actual_end_date',
} as const;
export type NativeDateField = keyof typeof NATIVE_DATE_FIELDS;

export const NATIVE_FIELD_BINDINGS: Record<NativeDateField | 'progress', string> = {
  ...NATIVE_DATE_FIELDS,
  progress: 'item.progress',
};
export type NativeField = keyof typeof NATIVE_FIELD_BINDINGS;

/** Colunas cujo valor é gerado pelo sistema (não aceitam escrita via API). */
export const READ_ONLY_COLUMN_TYPES: ReadonlySet<string> = new Set<ColumnType>([
  'auto_id',
  'formula',
  'mirror',
  'progress',
  'dependency',
  'button',
  'creation_log',
  'last_updated',
  'item_id',
]);

export interface ItemRecord {
  id: string;
  tenantId: string;
  boardId: string;
  groupId: string;
  parentItemId: string | null;
  name: string;
  position: string;
  values: Record<string, Record<string, unknown>>;
  fieldVersions: Record<string, number>;
  version: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  progress: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface ItemDto {
  id: string;
  boardId: string;
  groupId: string;
  parentItemId: string | null;
  name: string;
  position: string;
  values: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  version: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  progress: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** Campos ocultados por permissão de coluna (valor retornado como null). */
  redactedFields: string[];
}

export interface ColumnVisibility {
  /** Chaves de colunas ocultas para o usuário. */
  hidden: ReadonlySet<string>;
  /** Bindings (`item.planned_end_date`…) de colunas ocultas. */
  hiddenBindings: ReadonlySet<string>;
}

/** Remove valores de colunas que o usuário não pode ler (REST, GraphQL e WebSocket). */
export function redactValues(
  values: Readonly<Record<string, unknown>>,
  visibility: ColumnVisibility,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!visibility.hidden.has(key)) result[key] = value;
  }
  return result;
}

export function toItemDto(item: ItemRecord, visibility: ColumnVisibility): ItemDto {
  const redactedFields: string[] = [];
  const native = (field: NativeField, value: string | null): string | null => {
    if (visibility.hiddenBindings.has(NATIVE_FIELD_BINDINGS[field])) {
      redactedFields.push(field);
      return null;
    }
    return value;
  };
  const fieldVersions: Record<string, number> = {};
  for (const [key, version] of Object.entries(item.fieldVersions)) {
    if (!visibility.hidden.has(key)) fieldVersions[key] = version;
  }
  return {
    id: item.id,
    boardId: item.boardId,
    groupId: item.groupId,
    parentItemId: item.parentItemId,
    name: item.name,
    position: item.position,
    values: redactValues(item.values, visibility),
    fieldVersions,
    version: item.version,
    plannedStartDate: native('plannedStartDate', item.plannedStartDate),
    plannedEndDate: native('plannedEndDate', item.plannedEndDate),
    replannedStartDate: native('replannedStartDate', item.replannedStartDate),
    replannedEndDate: native('replannedEndDate', item.replannedEndDate),
    actualStartDate: native('actualStartDate', item.actualStartDate),
    actualEndDate: native('actualEndDate', item.actualEndDate),
    progress: native('progress', item.progress),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    archivedAt: item.archivedAt?.toISOString() ?? null,
    redactedFields,
  };
}

/** Ids (pessoas e times) presentes nas colunas de pessoas — usados no roteamento de eventos. */
export function assigneeIds(
  values: Readonly<Record<string, unknown>>,
  peopleKeys: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const key of peopleKeys) {
    const value = values[key] as { personIds?: unknown; teamIds?: unknown } | undefined;
    for (const list of [value?.personIds, value?.teamIds]) {
      if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
    }
  }
  return [...ids];
}
