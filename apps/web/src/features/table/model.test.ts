import { describe, expect, it } from 'vitest';

import { makeItem } from '../../../test/fixtures';
import {
  GROUP_A,
  GROUP_B,
  LABEL_DONE,
  LABEL_TODO,
  makeBoard,
  makeColumn,
} from '../../../test/board-fixtures';
import {
  applyCellWrite,
  buildRows,
  bucketize,
  canEditColumn,
  cellWrite,
  columnAggregate,
  gridColumns,
  NONE_BUCKET,
  reorderKeys,
  toItemState,
  type BucketLabels,
} from './model';

const labels: BucketLabels = {
  none: '(vazio)',
  checked: 'Marcado',
  unchecked: 'Desmarcado',
  person: (id) => `Pessoa ${id}`,
  month: (yearMonth) => yearMonth,
};

const item = (id: string, groupId: string, values: Record<string, unknown> = {}) =>
  makeItem({ id, groupId, name: `Item ${id}`, values });

describe('gridColumns', () => {
  it('nome sempre primeiro e fixado; fixadas antes das demais; ocultas ficam de fora', () => {
    const board = makeBoard();
    const columns = gridColumns(
      board,
      {
        hiddenColumnKeys: ['c_prazo'],
        pinnedColumnKeys: ['c_total'],
        columnWidths: { c_ust: 10_000 },
      },
      'Item',
    );
    expect(columns.map((column) => column.key)).toEqual(['name', 'c_total', 'c_status', 'c_ust']);
    expect(columns.filter((column) => column.pinned).map((column) => column.key)).toEqual([
      'name',
      'c_total',
    ]);
    expect(columns.find((column) => column.key === 'c_ust')?.width).toBe(800);
    // Fórmula abre? Não: somente leitura.
    expect(columns.find((column) => column.key === 'c_total')?.writable).toBe(false);
  });

  it('respeita a ordem da view e as permissões de coluna', () => {
    const board = makeBoard({ permissions: ['board.read', 'item.update_assigned'] });
    const columns = gridColumns(
      board,
      { hiddenColumnKeys: [], columnOrder: ['c_prazo', 'c_status'] },
      'Item',
    );
    expect(columns.map((column) => column.key)).toEqual([
      'name',
      'c_prazo',
      'c_status',
      'c_ust',
      'c_total',
    ]);
    expect(canEditColumn(board, board.columns[0] ?? null)).toBe(true);
    expect(canEditColumn(makeBoard({ permissions: ['board.read'] }), null)).toBe(false);
    expect(canEditColumn(board, makeColumn({ key: 'c_dep', type: 'dependency' }))).toBe(true);
    expect(canEditColumn(board, makeColumn({ key: 'c_x', type: 'text', canEdit: false }))).toBe(
      false,
    );
  });

  it('reorderKeys move antes da chave alvo ou para o fim', () => {
    expect(reorderKeys(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderKeys(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
  });
});

describe('agrupamento e linhas', () => {
  const board = makeBoard();
  const items = [
    item('1', GROUP_A, { c_status: { labelId: LABEL_DONE } }),
    item('2', GROUP_B, { c_status: { labelId: LABEL_TODO } }),
    item('3', GROUP_A),
  ];

  it('por grupo: preserva a ordem do board e inclui grupos vazios quando pedido', () => {
    const buckets = bucketize(board, [items[1] ?? item('x', GROUP_B)], 'group', labels, true);
    expect(buckets.map((bucket) => [bucket.key, bucket.items.length])).toEqual([
      [GROUP_A, 0],
      [GROUP_B, 1],
    ]);
    expect(bucketize(board, [], 'group', labels, false)).toEqual([]);
  });

  it('por status: rótulos na ordem configurada e balde "vazio" por último', () => {
    const buckets = bucketize(board, items, 'c_status', labels, false);
    expect(buckets.map((bucket) => bucket.key)).toEqual([LABEL_TODO, LABEL_DONE, NONE_BUCKET]);
    expect(buckets.at(-1)?.label).toBe('(vazio)');
  });

  it('dois níveis com cabeçalhos, itens, linha de adicionar e rodapé; recolhido some', () => {
    const rows = buildRows({
      board,
      items,
      levels: ['group', 'c_status'],
      labels,
      collapsed: new Set([`group=${GROUP_B}`]),
      expanded: new Set(['1']),
      subitems: new Map([['1', [makeItem({ id: 's1', parentItemId: '1', groupId: GROUP_A })]]]),
      canCreate: true,
      includeEmptyGroups: true,
    });
    expect(
      rows.map(
        (row) =>
          `${row.kind}:${row.kind === 'item' ? row.id : row.kind === 'header' ? row.path : ''}`,
      ),
    ).toEqual([
      `header:group=${GROUP_A}`,
      `header:group=${GROUP_A}/c_status=${LABEL_DONE}`,
      'item:1',
      'item:s1',
      'add:',
      'add:',
      'footer:',
      `header:group=${GROUP_A}/c_status=${NONE_BUCKET}`,
      'item:3',
      'add:',
      'footer:',
      'footer:',
      `header:group=${GROUP_B}`,
    ]);
    const sub = rows.find((row) => row.kind === 'item' && row.id === 's1');
    expect(sub?.kind === 'item' ? sub.depth : null).toBe(1);
  });
});

describe('agregados de rodapé', () => {
  const board = makeBoard();
  const ust = board.columns[1] ?? makeColumn({ key: 'c_ust', type: 'number' });

  it('soma decimal exata (sem float) e respeita colunas ocultas por permissão', () => {
    const items = [
      makeItem({ id: '1', values: { c_ust: { n: '0.1' } } }),
      makeItem({ id: '2', values: { c_ust: { n: '0.2' } } }),
      makeItem({ id: '3', values: { c_ust: { n: '100' } }, redactedFields: ['c_ust'] }),
    ];
    expect(columnAggregate(ust, items)).toEqual({
      kind: 'numeric',
      aggregate: 'sum',
      value: '0.3',
    });
    expect(columnAggregate({ ...ust, settings: { aggregate: 'avg' } }, items)).toEqual({
      kind: 'numeric',
      aggregate: 'avg',
      value: '0.15',
    });
  });

  it('distribuição de status com segmento de vazios', () => {
    const status = board.columns[0] ?? makeColumn({ key: 'c_status', type: 'status' });
    const result = columnAggregate(status, [
      makeItem({ id: '1', values: { c_status: { labelId: LABEL_DONE } } }),
      makeItem({ id: '2', values: { c_status: { labelId: LABEL_DONE } } }),
      makeItem({ id: '3' }),
    ]);
    expect(result).toEqual({
      kind: 'distribution',
      total: 3,
      segments: [
        { key: LABEL_DONE, label: 'Concluído', color: '#00c875', count: 2 },
        { key: NONE_BUCKET, label: '', color: '#c4c4c4', count: 1 },
      ],
    });
  });

  it('demais tipos contam preenchidos', () => {
    const prazo = board.columns[2] ?? makeColumn({ key: 'c_prazo', type: 'date' });
    expect(
      columnAggregate(prazo, [
        makeItem({ values: { c_prazo: { d: '2026-10-15' } } }),
        makeItem({ id: 'x' }),
      ]),
    ).toEqual({
      kind: 'count',
      filled: 1,
      total: 2,
    });
  });
});

describe('colunas vinculadas a campos nativos', () => {
  it('escrita vai em `fields` e o otimista atualiza o campo do item', () => {
    const column = makeColumn({ key: 'c_fim', type: 'date', binding: 'item.planned_end_date' });
    expect(cellWrite(column, { d: '2026-10-20' })).toEqual({
      fields: { plannedEndDate: '2026-10-20' },
    });
    expect(cellWrite(column, null)).toEqual({ fields: { plannedEndDate: null } });
    const next = applyCellWrite(makeItem(), column, { d: '2026-10-20' });
    expect(next.plannedEndDate).toBe('2026-10-20');
    expect(toItemState(makeBoard(), next).fields.planned_end_date).toBe('2026-10-20');
  });

  it('item concluído pelo status principal', () => {
    const state = toItemState(
      makeBoard(),
      makeItem({ values: { c_status: { labelId: LABEL_DONE } } }),
    );
    expect(state.completed).toBe(true);
  });
});
