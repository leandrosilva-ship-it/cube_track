import { describe, expect, it } from 'vitest';

import { resolveFieldType, toBranding, toFieldDto, type FormFieldRow } from './form.js';

describe('toBranding', () => {
  it('extrai só os campos string conhecidos, ignorando o resto', () => {
    expect(
      toBranding({ logoUrl: 'https://x/logo.png', primaryColor: '#000', extra: 'ignorado' }),
    ).toEqual({
      logoUrl: 'https://x/logo.png',
      primaryColor: '#000',
      thankYouMessage: null,
      redirectUrl: null,
    });
  });

  it('null/undefined viram todos os campos null, sem lançar', () => {
    expect(toBranding(null)).toEqual({
      logoUrl: null,
      primaryColor: null,
      thankYouMessage: null,
      redirectUrl: null,
    });
    expect(toBranding(undefined)).toEqual({
      logoUrl: null,
      primaryColor: null,
      thankYouMessage: null,
      redirectUrl: null,
    });
  });

  it('valores que não são string viram null (ex.: número onde se esperava texto)', () => {
    expect(toBranding({ logoUrl: 42 })).toEqual({
      logoUrl: null,
      primaryColor: null,
      thankYouMessage: null,
      redirectUrl: null,
    });
  });
});

describe('toFieldDto', () => {
  const row: FormFieldRow = {
    id: 'f1',
    formId: 'form1',
    columnKey: 'c_email',
    label: 'E-mail',
    helpText: 'Seu e-mail de contato',
    fieldType: 'email',
    isRequired: true,
    showWhen: null,
    settings: { placeholder: 'voce@exemplo.com' },
    position: 'a0',
  };

  it('projeta a linha do banco para o DTO, mantendo showWhen null como null', () => {
    expect(toFieldDto(row)).toEqual({
      id: 'f1',
      formId: 'form1',
      columnKey: 'c_email',
      label: 'E-mail',
      helpText: 'Seu e-mail de contato',
      fieldType: 'email',
      isRequired: true,
      showWhen: null,
      settings: { placeholder: 'voce@exemplo.com' },
      position: 'a0',
    });
  });

  it('preserva showWhen quando presente (condição de exibição)', () => {
    const condition = { op: 'and', conditions: [] };
    expect(toFieldDto({ ...row, showWhen: condition }).showWhen).toEqual(condition);
  });
});

describe('resolveFieldType', () => {
  it('campo nativo "name": aceita um tipo nativo válido', () => {
    expect(resolveFieldType('name', undefined, 'text')).toBe('text');
  });

  it('campo nativo "description": aceita um tipo nativo válido', () => {
    expect(resolveFieldType('description', undefined, 'long_text')).toBe('long_text');
  });

  it('sem columnKey (campo totalmente livre): aceita um tipo nativo válido', () => {
    expect(resolveFieldType(null, undefined, 'checkbox')).toBe('checkbox');
  });

  it('campo nativo com tipo inválido lança erro', () => {
    expect(() => resolveFieldType('name', undefined, 'status')).toThrow(
      'Tipo de campo inválido para resposta nativa.',
    );
  });

  it('coluna real do board: usa o tipo real da coluna, ignorando o requestedType', () => {
    expect(resolveFieldType('c_status', 'status', 'text')).toBe('status');
  });

  it('coluna inexistente no board (columnType undefined) lança erro', () => {
    expect(() => resolveFieldType('c_apagada', undefined, 'text')).toThrow(
      'Coluna inexistente no board.',
    );
  });
});
