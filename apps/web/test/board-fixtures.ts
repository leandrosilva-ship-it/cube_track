import type { BoardColumn, BoardDetail } from '@/lib/api/types';

import { BOARD_ID } from './fixtures';

export const GROUP_A = '01a13ae4-0000-7000-8000-0000000000aa';
export const GROUP_B = '01a13ae4-0000-7000-8000-0000000000bb';
export const LABEL_TODO = '01a13ae4-0000-7000-8000-00000000a001';
export const LABEL_DONE = '01a13ae4-0000-7000-8000-00000000a002';

export function makeColumn(
  overrides: Partial<BoardColumn> & Pick<BoardColumn, 'key' | 'type'>,
): BoardColumn {
  return {
    id: `col-${overrides.key}`,
    title: overrides.key,
    description: null,
    settings: {},
    binding: null,
    isRequired: false,
    requiredWhen: null,
    defaultValue: null,
    isHidden: false,
    position: 'a0',
    width: null,
    permissions: {},
    canEdit: true,
    labels: [],
    options: [],
    ...overrides,
  };
}

export const STATUS_COLUMN = makeColumn({
  key: 'c_status',
  type: 'status',
  title: 'Status',
  labels: [
    {
      id: LABEL_TODO,
      columnId: 'col-c_status',
      label: 'A fazer',
      color: '#c4c4c4',
      category: 'not_started',
      position: 'a0',
    },
    {
      id: LABEL_DONE,
      columnId: 'col-c_status',
      label: 'Concluído',
      color: '#00c875',
      category: 'done',
      position: 'a1',
    },
  ],
});

export function makeBoard(overrides: Partial<BoardDetail> = {}): BoardDetail {
  return {
    id: BOARD_ID,
    workspaceId: '01a13ae4-0000-7000-8000-0000000000cc',
    folderId: null,
    kind: 'board',
    name: 'Board',
    description: null,
    icon: null,
    visibility: 'main',
    terminology: { singular: 'item', plural: 'itens' },
    settings: { statusColumnKey: 'c_status' },
    isTemplate: false,
    seq: 1,
    permissions: [
      'board.read',
      'item.create',
      'item.update',
      'item.delete',
      'column.manage',
      'group.manage',
    ],
    itemScope: 'all',
    groups: [
      { id: GROUP_A, name: 'Grupo A', color: '#579bfc', position: 'a0', isCollapsed: false },
      { id: GROUP_B, name: 'Grupo B', color: '#a25ddc', position: 'a1', isCollapsed: false },
    ],
    columns: [
      STATUS_COLUMN,
      makeColumn({
        key: 'c_ust',
        type: 'number',
        title: 'UST',
        settings: { unit: 'UST', decimals: 2 },
      }),
      makeColumn({ key: 'c_prazo', type: 'date', title: 'Prazo' }),
      makeColumn({
        key: 'c_total',
        type: 'formula',
        title: 'Total',
        settings: { expression: '{c_ust} * 2' },
      }),
    ],
    ...overrides,
  };
}
