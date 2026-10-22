import { describe, expect, it } from 'vitest';

import type { FormField } from '@/lib/api/types';
import { makeBoard, makeColumn } from '../../../test/board-fixtures';

import {
  boardFieldOptions,
  eligibleColumns,
  nativeQuestionOptions,
  positionFor,
  sortFieldsByPosition,
  visibleFormFields,
} from './model';

function makeField(overrides: Partial<FormField> & Pick<FormField, 'id'>): FormField {
  return {
    formId: 'form-1',
    columnKey: null,
    label: 'Campo',
    helpText: null,
    fieldType: 'text',
    isRequired: false,
    showWhen: null,
    settings: {},
    position: 'a0',
    ...overrides,
  };
}

describe('eligibleColumns', () => {
  it('exclui colunas vinculadas e somente-leitura/computadas', () => {
    const board = makeBoard({
      columns: [
        makeColumn({ key: 'c_text', type: 'text' }),
        makeColumn({ key: 'c_bound', type: 'date', binding: 'item.planned_end_date' }),
        makeColumn({ key: 'c_formula', type: 'formula' }),
        makeColumn({ key: 'c_rollup', type: 'rollup' }),
      ],
    });
    const keys = eligibleColumns(board).map((column) => column.key);
    expect(keys).toEqual(['c_text']);
  });
});

describe('boardFieldOptions', () => {
  it('inclui nome/descrição reservados quando ainda não usados, mais colunas elegíveis', () => {
    const board = makeBoard({ columns: [makeColumn({ key: 'c_text', type: 'text', title: 'Observação' })] });
    const options = boardFieldOptions(board, [], { name: 'Nome', description: 'Descrição' });
    expect(options.map((option) => option.columnKey)).toEqual(['name', 'description', 'c_text']);
  });

  it('remove opções já usadas por um campo existente', () => {
    const board = makeBoard({ columns: [makeColumn({ key: 'c_text', type: 'text', title: 'Observação' })] });
    const existing = [makeField({ id: 'f1', columnKey: 'name' }), makeField({ id: 'f2', columnKey: 'c_text' })];
    const options = boardFieldOptions(board, existing, { name: 'Nome', description: 'Descrição' });
    expect(options.map((option) => option.columnKey)).toEqual(['description']);
  });
});

describe('nativeQuestionOptions', () => {
  it('sempre oferece os 7 tipos nativos, sem coluna', () => {
    const labels = {
      text: 'Texto curto',
      long_text: 'Texto longo',
      email: 'E-mail',
      phone: 'Telefone',
      number: 'Número',
      date: 'Data',
      checkbox: 'Caixa de seleção',
    };
    const options = nativeQuestionOptions(labels);
    expect(options).toHaveLength(7);
    expect(options.every((option) => option.columnKey === null)).toBe(true);
  });
});

describe('sortFieldsByPosition', () => {
  it('ordena pela fractional-index de posição', () => {
    const fields = [makeField({ id: 'c', position: 'a2' }), makeField({ id: 'a', position: 'a0' }), makeField({ id: 'b', position: 'a1' })];
    expect(sortFieldsByPosition(fields).map((field) => field.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('positionFor', () => {
  const ordered = [
    makeField({ id: 'a', position: 'a0' }),
    makeField({ id: 'b', position: 'a1' }),
    makeField({ id: 'c', position: 'a2' }),
  ];

  it('move para o início devolve beforeId do primeiro campo restante', () => {
    expect(positionFor(ordered, 'c', 0)).toEqual({ beforeId: 'a' });
  });

  it('move para o fim devolve afterId do último campo restante', () => {
    expect(positionFor(ordered, 'a', 2)).toEqual({ afterId: 'c' });
  });

  it('move para o meio devolve afterId do vizinho anterior', () => {
    expect(positionFor(ordered, 'c', 1)).toEqual({ afterId: 'a' });
  });
});

describe('visibleFormFields', () => {
  const columnTypes = new Map([['c_text', 'text']]);
  const gate = makeField({ id: 'gate', columnKey: 'c_text', fieldType: 'text' });
  const gated = makeField({
    id: 'gated',
    columnKey: null,
    fieldType: 'text',
    showWhen: { op: 'and', conditions: [{ field: 'c_text', operator: 'is', value: 'sim' }] },
  });
  const always = makeField({ id: 'always', columnKey: null, fieldType: 'text', showWhen: null });

  it('mantém um campo sem showWhen sempre visível', () => {
    const visible = visibleFormFields([always], new Map(), columnTypes);
    expect(visible.map((field) => field.id)).toEqual(['always']);
  });

  it('esconde um campo cuja condição ainda não foi satisfeita', () => {
    const visible = visibleFormFields([gate, always, gated], new Map([['gate', 'não']]), columnTypes);
    expect(visible.map((field) => field.id)).toEqual(['gate', 'always']);
  });

  it('mostra o campo assim que a condição passa a ser satisfeita', () => {
    const visible = visibleFormFields([gate, always, gated], new Map([['gate', 'sim']]), columnTypes);
    expect(visible.map((field) => field.id)).toEqual(['gate', 'always', 'gated']);
  });
});
