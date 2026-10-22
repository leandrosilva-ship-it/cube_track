import { describe, expect, it } from 'vitest';

import { matchesFilter, type EvaluableColumn } from './columns/conditions.js';
import {
  FORM_DESCRIPTION_FIELD,
  FORM_NAME_FIELD,
  mapFormAnswers,
  partialItemStateFromAnswers,
  validateNativeAnswer,
  wrapNativeAnswer,
  type FormFieldLike,
} from './forms.js';

describe('validateNativeAnswer', () => {
  it('valida cada tipo nativo', () => {
    expect(validateNativeAnswer('email', 'a@b.com')).toBe(true);
    expect(validateNativeAnswer('email', 'nao-e-email')).toBe(false);
    expect(validateNativeAnswer('number', '12.5')).toBe(true);
    expect(validateNativeAnswer('number', 'abc')).toBe(false);
    expect(validateNativeAnswer('date', '2026-11-03')).toBe(true);
    expect(validateNativeAnswer('date', '03/11/2026')).toBe(false);
    expect(validateNativeAnswer('checkbox', true)).toBe(true);
    expect(validateNativeAnswer('checkbox', 'sim')).toBe(false);
    expect(validateNativeAnswer('text', 'qualquer coisa')).toBe(true);
  });
});

describe('wrapNativeAnswer', () => {
  it('empacota no formato de valor da coluna', () => {
    expect(wrapNativeAnswer('text', 'Olá')).toEqual({ text: 'Olá' });
    expect(wrapNativeAnswer('email', 'a@b.com')).toEqual({ email: 'a@b.com' });
    expect(wrapNativeAnswer('number', 12.5)).toEqual({ n: '12.5' });
    expect(wrapNativeAnswer('date', '2026-11-03')).toEqual({ d: '2026-11-03' });
    expect(wrapNativeAnswer('checkbox', true)).toEqual({ checked: true });
    expect(wrapNativeAnswer('checkbox', 'nope')).toBeNull();
  });
});

describe('mapFormAnswers', () => {
  const fields: FormFieldLike[] = [
    { id: 'f_name', columnKey: FORM_NAME_FIELD, fieldType: 'text', isRequired: true, showWhen: null },
    {
      id: 'f_desc',
      columnKey: FORM_DESCRIPTION_FIELD,
      fieldType: 'long_text',
      isRequired: false,
      showWhen: null,
    },
    { id: 'f_status', columnKey: 'c_status', fieldType: 'status', isRequired: true, showWhen: null },
    { id: 'f_email', columnKey: null, fieldType: 'email', isRequired: true, showWhen: null },
  ];
  const columnTypes = new Map([['c_status', 'status']]);

  it('mapeia nome, descrição e coluna real; ignora columnKey nulo', () => {
    const answers = new Map<string, unknown>([
      ['f_name', '  Nova demanda  '],
      ['f_desc', 'Descrição livre'],
      ['f_status', { labelId: 'label-1' }],
      ['f_email', 'a@b.com'],
    ]);
    const result = mapFormAnswers(fields, answers, columnTypes);
    expect(result.name).toBe('Nova demanda');
    expect(result.descriptionText).toBe('Descrição livre');
    expect(result.values).toEqual({ c_status: { labelId: 'label-1' } });
  });

  it('ignora respostas não dadas e nome em branco', () => {
    const result = mapFormAnswers(fields, new Map([['f_name', '   ']]), columnTypes);
    expect(result.name).toBeNull();
    expect(result.values).toEqual({});
  });
});

describe('partialItemStateFromAnswers + matchesFilter (showWhen reaproveita obrigatoriedade condicional)', () => {
  it('avalia a condição "mostrar quando" com as respostas já dadas', () => {
    const fields: FormFieldLike[] = [
      { id: 'f_urgente', columnKey: 'c_urgente', fieldType: 'checkbox', isRequired: false, showWhen: null },
      {
        id: 'f_motivo',
        columnKey: 'c_motivo',
        fieldType: 'text',
        isRequired: true,
        showWhen: { op: 'and', conditions: [{ field: 'c_urgente', operator: 'is', value: true }] },
      },
    ];
    const columnTypes = new Map([
      ['c_urgente', 'checkbox'],
      ['c_motivo', 'text'],
    ]);
    const columns: EvaluableColumn[] = [
      { key: 'c_urgente', type: 'checkbox', binding: null },
      { key: 'c_motivo', type: 'text', binding: null },
    ];
    const context = { currentUserId: 'u1', today: '2026-11-03' };

    const notUrgent = partialItemStateFromAnswers(fields, new Map([['f_urgente', false]]), columnTypes);
    const urgent = partialItemStateFromAnswers(fields, new Map([['f_urgente', true]]), columnTypes);
    const motivoShowWhen = fields[1]?.showWhen;
    expect(motivoShowWhen).not.toBeNull();
    if (motivoShowWhen === null || motivoShowWhen === undefined) throw new Error('unreachable');
    expect(matchesFilter(motivoShowWhen, notUrgent, columns, context)).toBe(false);
    expect(matchesFilter(motivoShowWhen, urgent, columns, context)).toBe(true);
  });
});
