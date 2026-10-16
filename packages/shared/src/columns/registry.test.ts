import { describe, expect, it } from 'vitest';

import {
  COLUMN_TYPES,
  isColumnType,
  isTransitionAllowed,
  parseColumnSettings,
  parseColumnValue,
} from './registry.js';

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

  it('aceita a coluna de status com transições opcionais entre rótulos', () => {
    const todo = '01a13f00-0000-7000-8000-000000000001';
    const doing = '01a13f00-0000-7000-8000-000000000002';
    const done = '01a13f00-0000-7000-8000-000000000003';
    expect(
      parseColumnSettings('status', { transitions: { [todo]: [doing], [doing]: [done, todo] } }),
    ).toEqual({ transitions: { [todo]: [doing], [doing]: [done, todo] } });
  });
});

describe('transições de status (ADR 0046)', () => {
  const todo = '01a13f00-0000-7000-8000-000000000001';
  const doing = '01a13f00-0000-7000-8000-000000000002';
  const done = '01a13f00-0000-7000-8000-000000000003';
  const transitions = { [todo]: [doing], [doing]: [done] };

  it('sem regras configuradas, qualquer transição vale', () => {
    expect(isTransitionAllowed(undefined, todo, done)).toBe(true);
  });

  it('rótulo de origem sem entrada no mapa também não é restrito (regra adicionada depois)', () => {
    expect(isTransitionAllowed(transitions, done, todo)).toBe(true);
  });

  it('bloqueia pular etapas quando a origem tem regra configurada', () => {
    expect(isTransitionAllowed(transitions, todo, done)).toBe(false);
    expect(isTransitionAllowed(transitions, todo, doing)).toBe(true);
  });

  it('criação (sem valor anterior) nunca é bloqueada pela regra', () => {
    expect(isTransitionAllowed(transitions, null, done)).toBe(true);
  });
});
