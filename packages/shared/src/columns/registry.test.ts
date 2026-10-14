import { describe, expect, it } from 'vitest';

import { COLUMN_TYPES, isColumnType, parseColumnSettings, parseColumnValue } from './registry.js';

describe('registro de tipos de coluna', () => {
  it('declara cerca de 30 tipos', () => {
    expect(COLUMN_TYPES.length).toBeGreaterThanOrEqual(30);
    expect(isColumnType('status')).toBe(true);
    expect(isColumnType('inexistente')).toBe(false);
  });

  it('valida números como decimal em string (sem float)', () => {
    expect(parseColumnValue('number', { n: '12.5' })).toEqual({ n: '12.5' });
    expect(() => parseColumnValue('number', { n: 12.5 })).toThrow();
  });

  it('valida datas de negócio ISO sem fuso', () => {
    expect(parseColumnValue('date', { d: '2026-11-30' })).toEqual({ d: '2026-11-30' });
    expect(() => parseColumnValue('date', { d: '30/11/2026' })).toThrow();
  });

  it('rejeita chaves desconhecidas', () => {
    expect(() => parseColumnValue('checkbox', { checked: true, extra: 1 })).toThrow();
  });

  it('aplica defaults da coluna de ID automático', () => {
    expect(parseColumnSettings('auto_id', {})).toEqual({
      mask: '{YYYY}-{SEQ:4}',
      resetPeriod: 'never',
      applyToSubitems: false,
    });
    expect(() => parseColumnSettings('auto_id', { mask: '{YYYY}' })).toThrow();
  });
});
