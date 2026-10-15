import { describe, expect, it } from 'vitest';

import { makeItem } from '../../../test/fixtures';
import { LABEL_DONE, makeBoard } from '../../../test/board-fixtures';
import { normalizeRange, parseTsv, planFillDown, planPaste, toTsv } from './clipboard';
import { gridColumns } from './model';

const board = makeBoard();
const columns = gridColumns(board, { hiddenColumnKeys: [] }, 'Item');
const items = [
  makeItem({ id: 'i1', name: 'Um', values: { c_ust: { n: '1' } } }),
  makeItem({ id: 'i2', name: 'Dois' }),
  makeItem({ id: 'i3', name: 'Três' }),
];
const directory = { people: [], teams: [] };

describe('TSV', () => {
  it('ida e volta com tabulação, quebra de linha e aspas', () => {
    const matrix = [
      ['a', 'b\tc'],
      ['linha\nnova', 'diz "oi"'],
    ];
    expect(parseTsv(toTsv(matrix))).toEqual(matrix);
    expect(parseTsv('x\ty\r\n1\t2')).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ]);
  });

  it('normaliza a seleção retangular em qualquer direção', () => {
    expect(normalizeRange({ row: 3, col: 1 }, { row: 1, col: 4 })).toEqual({
      top: 1,
      bottom: 3,
      left: 1,
      right: 4,
    });
  });
});

describe('colar', () => {
  it('converte texto pelo tipo (pt-BR) e recusa colunas somente leitura', () => {
    // colunas: name, c_status, c_ust, c_prazo, c_total
    const plan = planPaste(
      [['Concluído', '1.234,5', '15/10/2026', '99']],
      { row: 1, col: 1 },
      null,
      items,
      columns,
      directory,
      'pt-BR',
    );
    expect(plan.writes).toEqual([
      {
        item: items[1],
        values: {
          c_status: { labelId: LABEL_DONE },
          c_ust: { n: '1234.5' },
          c_prazo: { d: '2026-10-15' },
        },
      },
    ]);
    expect(plan.rejected).toEqual([{ itemId: 'i2', columnKey: 'c_total', reason: 'read_only' }]);
  });

  it('uma célula copiada preenche toda a seleção; valores iguais não geram escrita', () => {
    const plan = planPaste(
      [['1']],
      { row: 0, col: 2 },
      { top: 0, bottom: 2, left: 2, right: 2 },
      items,
      columns,
      directory,
      'pt-BR',
    );
    expect(plan.writes.map((write) => write.item.id)).toEqual(['i2', 'i3']);
  });

  it('nome vazio é recusado; rótulo desconhecido também', () => {
    const plan = planPaste(
      [['', 'Inexistente']],
      { row: 0, col: 0 },
      null,
      items,
      columns,
      directory,
      'pt-BR',
    );
    expect(plan.writes).toEqual([]);
    expect(plan.rejected.map((entry) => entry.reason)).toEqual(['invalid', 'unknown_label']);
  });
});

describe('preencher para baixo', () => {
  it('replica a primeira linha da seleção', () => {
    const plan = planFillDown({ top: 0, bottom: 2, left: 0, right: 2 }, items, columns);
    expect(plan.writes).toEqual([
      { item: items[1], name: 'Um', values: { c_ust: { n: '1' } } },
      { item: items[2], name: 'Um', values: { c_ust: { n: '1' } } },
    ]);
  });
});
