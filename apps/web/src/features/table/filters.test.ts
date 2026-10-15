import { describe, expect, it } from 'vitest';

import { makeBoard, makeColumn } from '../../../test/board-fixtures';
import {
  changeOperator,
  dueDateColumn,
  filterFields,
  initialCondition,
  operatorsFor,
  quickFilter,
  valueInputFor,
} from './filters';
import { toggleSort } from './grid-header';

const titles = { name: 'Nome', group: 'Grupo', createdAt: 'Criado', updatedAt: 'Atualizado' };

describe('construtor de filtros', () => {
  const board = makeBoard();
  const fields = filterFields(board.columns, titles);

  it('oferece nome, grupo, colunas filtráveis e datas de sistema', () => {
    expect(fields.map((field) => field.key)).toEqual([
      'name',
      'group_id',
      'c_status',
      'c_ust',
      'c_prazo',
      'c_total',
      'created_at',
      'updated_at',
    ]);
  });

  it('operadores e entradas por tipo (data aceita "atrasados" sem valor)', () => {
    const prazo = fields.find((field) => field.key === 'c_prazo');
    if (prazo === undefined) throw new Error('prazo');
    expect(operatorsFor(prazo)).toContain('overdue');
    expect(valueInputFor(prazo, 'overdue')).toBe('none');
    expect(valueInputFor(prazo, 'is')).toBe('date');
    const status = fields.find((field) => field.key === 'c_status');
    if (status === undefined) throw new Error('status');
    expect(initialCondition(status)).toEqual({ field: 'c_status', operator: 'any_of' });
  });

  it('trocar operador converte lista ↔ escalar', () => {
    const ust = fields.find((field) => field.key === 'c_ust');
    if (ust === undefined) throw new Error('ust');
    expect(changeOperator({ field: 'c_ust', operator: 'is', value: '3' }, ust, 'gt')).toEqual({
      field: 'c_ust',
      operator: 'gt',
      value: '3',
    });
    expect(changeOperator({ field: 'c_ust', operator: 'is', value: '3' }, ust, 'is_empty')).toEqual(
      { field: 'c_ust', operator: 'is_empty' },
    );
    const status = fields.find((field) => field.key === 'c_status');
    if (status === undefined) throw new Error('status');
    expect(
      changeOperator({ field: 'c_status', operator: 'any_of', value: 'x' }, status, 'none_of'),
    ).toEqual({
      field: 'c_status',
      operator: 'none_of',
      value: ['x'],
    });
  });

  it('atalhos "meus itens" e "atrasados"', () => {
    const columns = [...board.columns, makeColumn({ key: 'c_owner', type: 'people' })];
    expect(quickFilter('mine', columns, null)).toEqual([
      { field: 'c_owner', operator: 'any_of', value: ['me'] },
    ]);
    expect(quickFilter('overdue', columns, dueDateColumn(columns)?.key ?? null)).toEqual([
      { field: 'c_prazo', operator: 'overdue' },
    ]);
  });
});

describe('ordenação múltipla', () => {
  it('clique alterna asc → desc → nenhum; Shift acumula até 3 termos', () => {
    expect(toggleSort(undefined, 'name', false)).toBe('name:asc');
    expect(toggleSort('name:asc', 'name', false)).toBe('name:desc');
    expect(toggleSort('name:desc', 'name', false)).toBeUndefined();
    expect(toggleSort('name:asc', 'c_ust', true)).toBe('name:asc,c_ust:asc');
    expect(toggleSort('name:asc,c_ust:asc', 'c_ust', true)).toBe('name:asc,c_ust:desc');
    expect(toggleSort('a:asc,b:asc,c:asc', 'd', true)).toBe('b:asc,c:asc,d:asc');
  });
});
