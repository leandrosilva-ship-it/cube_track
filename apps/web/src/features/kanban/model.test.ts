import { defaultKanbanConfig } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import { makeItem } from '../../../test/fixtures';
import {
  GROUP_A,
  GROUP_B,
  LABEL_DONE,
  LABEL_TODO,
  makeBoard,
} from '../../../test/board-fixtures';
import { ALL_SWIMLANE, cellId, countInColumn, kanbanBucketsFor, kanbanCells, kanbanKeyOf } from './model';

const labels = {
  none: '(vazio)',
  checked: 'Marcado',
  unchecked: 'Desmarcado',
  person: (id: string) => `Pessoa ${id}`,
};

const item = (id: string, groupId: string, values: Record<string, unknown> = {}) =>
  makeItem({ id, groupId, name: `Item ${id}`, values });

describe('kanbanBucketsFor', () => {
  it('status: rótulos na ordem do board; mantém buckets vazios quando hideEmpty=false', () => {
    const board = makeBoard();
    const buckets = kanbanBucketsFor(board, 'c_status', [], labels, false);
    expect(buckets.map((bucket) => bucket.key)).toEqual([LABEL_TODO, LABEL_DONE, '∅']);
    const withLabels = kanbanBucketsFor(
      board,
      'c_status',
      [item('1', GROUP_A, { c_status: { labelId: LABEL_TODO } })],
      labels,
      false,
    );
    expect(withLabels.map((bucket) => bucket.key)).toEqual([LABEL_TODO, LABEL_DONE, '∅']);
  });

  it('status: hideEmpty=true remove buckets sem itens (inclusive "sem valor")', () => {
    const board = makeBoard();
    const buckets = kanbanBucketsFor(
      board,
      'c_status',
      [item('1', GROUP_A, { c_status: { labelId: LABEL_TODO } })],
      labels,
      true,
    );
    expect(buckets.map((bucket) => bucket.key)).toEqual([LABEL_TODO]);
  });

  it("'group': uma coluna por grupo do board, na ordem do board", () => {
    const board = makeBoard();
    const buckets = kanbanBucketsFor(board, 'group', [], labels, false);
    expect(buckets.map((bucket) => bucket.key)).toEqual([GROUP_A, GROUP_B]);
    expect(buckets.every((bucket) => bucket.groupId !== null)).toBe(true);
  });

  it('pessoas: dinâmico, só os ids presentes nos itens', () => {
    const board = makeBoard({
      columns: [
        ...makeBoard().columns,
        {
          id: 'col-c_resp',
          key: 'c_resp',
          type: 'people',
          title: 'Responsáveis',
          description: null,
          settings: {},
          binding: null,
          isRequired: false,
          requiredWhen: null,
          defaultValue: null,
          isHidden: false,
          position: 'a9',
          width: null,
          permissions: {},
          canEdit: true,
          labels: [],
          options: [],
        },
      ],
    });
    const buckets = kanbanBucketsFor(
      board,
      'c_resp',
      [item('1', GROUP_A, { c_resp: { personIds: ['u1'], teamIds: [] } })],
      labels,
      true,
    );
    expect(buckets.map((bucket) => bucket.key)).toEqual(['u1']);
    expect(buckets[0]?.label).toBe('Pessoa u1');
  });
});

describe('kanbanKeyOf e kanbanCells', () => {
  const board = makeBoard();
  const items = [
    item('1', GROUP_A, { c_status: { labelId: LABEL_TODO } }),
    item('2', GROUP_A, { c_status: { labelId: LABEL_DONE } }),
    item('3', GROUP_B, { c_status: { labelId: LABEL_TODO } }),
  ];

  it('agrupa por coluna (columnsBy) sem raias: uma célula por valor', () => {
    const config = defaultKanbanConfig('c_status');
    const cells = kanbanCells(board, items, config);
    expect([...cells.keys()].sort()).toEqual(
      [cellId(ALL_SWIMLANE, LABEL_TODO), cellId(ALL_SWIMLANE, LABEL_DONE)].sort(),
    );
    expect(cells.get(cellId(ALL_SWIMLANE, LABEL_TODO))?.map((entry) => entry.id)).toEqual([
      '1',
      '3',
    ]);
  });

  it('colunas por status com raias por grupo: uma célula por combinação', () => {
    const config = { ...defaultKanbanConfig('c_status'), swimlanesBy: 'group' };
    const cells = kanbanCells(board, items, config);
    expect(cells.get(cellId(GROUP_A, LABEL_TODO))?.map((entry) => entry.id)).toEqual(['1']);
    expect(cells.get(cellId(GROUP_A, LABEL_DONE))?.map((entry) => entry.id)).toEqual(['2']);
    expect(cells.get(cellId(GROUP_B, LABEL_TODO))?.map((entry) => entry.id)).toEqual(['3']);
    expect(kanbanKeyOf(board, items[0] ?? item('x', GROUP_A), 'group')).toBe(GROUP_A);
  });

  it('countInColumn conta pelo valor de columnsBy, ignorando a raia', () => {
    const config = { ...defaultKanbanConfig('c_status'), swimlanesBy: 'group' };
    expect(countInColumn(board, items, config, LABEL_TODO)).toBe(2);
    expect(countInColumn(board, items, config, LABEL_DONE)).toBe(1);
  });
});
