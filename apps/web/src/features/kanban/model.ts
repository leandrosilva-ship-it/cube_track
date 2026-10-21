import type { KanbanConfig } from '@cube-track/shared';

import type { BoardColumn, BoardDetail, Item } from '@/lib/api/types';

import { bucketKeyOf, GROUP_LEVEL_GROUP, NONE_BUCKET } from '../table/model';

const NONE_COLOR = '#c4c4c4';
const DYNAMIC_COLOR = '#a25ddc';
const PEOPLE_COLOR = '#579bfc';

export interface KanbanBucketDef {
  key: string;
  label: string;
  color: string;
  /** Preenchido só para `'group'` (criar item direto na raia/coluna). */
  groupId: string | null;
}

export interface KanbanLabels {
  none: string;
  checked: string;
  unchecked: string;
  person: (id: string) => string;
}

/**
 * Buckets de um campo do Kanban (`columnsBy`/`swimlanesBy`): `'group'` usa os grupos do board;
 * status/lista/caixa têm enumeração fixa (rótulos/opções do board, nessa ordem); pessoas/tags são
 * dinâmicos (só os valores presentes nos itens). Ao contrário da Tabela, o Kanban pode manter
 * buckets vazios (`hideEmpty=false`) porque a coluna é a própria estrutura do quadro.
 */
export function kanbanBucketsFor(
  board: BoardDetail,
  field: string,
  items: readonly Item[],
  labels: KanbanLabels,
  hideEmpty: boolean,
): KanbanBucketDef[] {
  if (field === GROUP_LEVEL_GROUP) {
    return board.groups.map((group) => ({
      key: group.id,
      label: group.name,
      color: group.color,
      groupId: group.id,
    }));
  }
  const column = board.columns.find((entry) => entry.key === field);
  if (column === undefined)
    return kanbanBucketsFor(board, GROUP_LEVEL_GROUP, items, labels, hideEmpty);
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = bucketKeyOf(item, column);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const withGroup = (key: string, label: string, color: string): KanbanBucketDef => ({
    key,
    label,
    color,
    groupId: null,
  });
  let defs: KanbanBucketDef[];
  switch (column.type) {
    case 'status':
      defs = column.labels.map((label) => withGroup(label.id, label.label, label.color));
      break;
    case 'dropdown':
      defs = column.options.map((option) =>
        withGroup(option.id, option.label, option.color ?? NONE_COLOR),
      );
      break;
    case 'checkbox':
      defs = [
        withGroup('true', labels.checked, '#00c875'),
        withGroup('false', labels.unchecked, NONE_COLOR),
      ];
      break;
    case 'people':
    case 'tags': {
      const keys = [...counts.keys()].filter((key) => key !== NONE_BUCKET).sort();
      defs = keys.map((key) =>
        withGroup(key, column.type === 'people' ? labels.person(key) : key, PEOPLE_COLOR),
      );
      break;
    }
    default: {
      const keys = [...counts.keys()].filter((key) => key !== NONE_BUCKET).sort();
      defs = keys.map((key) => withGroup(key, key, DYNAMIC_COLOR));
    }
  }
  const withNone = [...defs, withGroup(NONE_BUCKET, labels.none, NONE_COLOR)];
  return hideEmpty ? withNone.filter((bucket) => (counts.get(bucket.key) ?? 0) > 0) : withNone;
}

/** Chave de bucket de um item para um campo (`'group'` ou coluna) — ver `kanbanBucketsFor`. */
export function kanbanKeyOf(board: BoardDetail, item: Item, field: string): string {
  if (field === GROUP_LEVEL_GROUP) return item.groupId;
  const column = board.columns.find((entry) => entry.key === field);
  return column === undefined ? item.groupId : bucketKeyOf(item, column);
}

/** Coluna usada em `columnsBy`, se existir de verdade (não `'group'`). */
export function columnsByColumn(board: BoardDetail, config: KanbanConfig): BoardColumn | null {
  if (config.columnsBy === GROUP_LEVEL_GROUP) return null;
  return board.columns.find((entry) => entry.key === config.columnsBy) ?? null;
}

/** Contagem de itens já numa coluna (para o indicador de WIP). */
export function countInColumn(
  board: BoardDetail,
  items: readonly Item[],
  config: KanbanConfig,
  columnKey: string,
): number {
  return items.filter((item) => kanbanKeyOf(board, item, config.columnsBy) === columnKey).length;
}

export interface KanbanCell {
  swimlaneKey: string;
  columnKey: string;
  items: Item[];
}

export const ALL_SWIMLANE = '__all__';

/** Divide os itens em células (raia × coluna), ordenadas por posição dentro de cada uma. */
export function kanbanCells(
  board: BoardDetail,
  items: readonly Item[],
  config: KanbanConfig,
): Map<string, Item[]> {
  const cells = new Map<string, Item[]>();
  for (const item of items) {
    const columnKey = kanbanKeyOf(board, item, config.columnsBy);
    const swimlaneKey = config.swimlanesBy === undefined ? ALL_SWIMLANE : kanbanKeyOf(board, item, config.swimlanesBy);
    const cellId = `${swimlaneKey}::${columnKey}`;
    const list = cells.get(cellId);
    if (list === undefined) cells.set(cellId, [item]);
    else list.push(item);
  }
  for (const list of cells.values()) list.sort((a, b) => (a.position < b.position ? -1 : 1));
  return cells;
}

export function cellId(swimlaneKey: string, columnKey: string): string {
  return `${swimlaneKey}::${columnKey}`;
}

/**
 * Tipos de coluna com semântica clara de "mover para este valor" (ao contrário de data/texto/
 * número, que não têm um conjunto fixo de baldes para onde arrastar). `columnsBy`/`swimlanesBy`
 * só oferecem esses tipos (além de `'group'`) no diálogo de configuração.
 */
export const KANBAN_FIELD_TYPES = new Set(['status', 'dropdown', 'people', 'checkbox', 'tags']);

/** Valor a gravar quando um cartão é solto num bucket (`null` limpa — ex.: baldes "sem valor"). */
export function valueForBucket(
  column: BoardColumn,
  key: string,
): Record<string, unknown> | null {
  if (key === NONE_BUCKET) return null;
  switch (column.type) {
    case 'status':
      return { labelId: key };
    case 'dropdown':
      return { optionIds: [key] };
    case 'checkbox':
      return { checked: key === 'true' };
    case 'people':
      return { personIds: [key], teamIds: [] };
    case 'tags':
      return { tags: [key] };
    default:
      return null;
  }
}
