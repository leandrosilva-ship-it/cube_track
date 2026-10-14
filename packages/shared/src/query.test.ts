import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './pagination.js';
import { filterDepth, filterFields, FilterGroupSchema, parseSort, sortSignature } from './query.js';

describe('cursor', () => {
  it('codifica e decodifica, inclusive com acentos e nulos', () => {
    const cursor = { sort: 'name:asc', keys: ['Órgão "x"', null, 3], id: 'abc' };
    expect(decodeCursor(encodeCursor(cursor), 'name:asc')).toEqual(cursor);
  });

  it('rejeita cursor de outra ordenação ou corrompido', () => {
    const raw = encodeCursor({ sort: 'name:asc', keys: ['a'], id: '1' });
    expect(decodeCursor(raw, 'name:desc')).toBeNull();
    expect(decodeCursor('###', 'name:asc')).toBeNull();
    expect(
      decodeCursor(encodeCursor({ sort: 'x', keys: [], id: '1' }).slice(0, 5), 'x'),
    ).toBeNull();
  });
});

describe('filtros', () => {
  const filter = {
    op: 'and' as const,
    conditions: [
      { field: 'c_status', operator: 'any_of' as const, value: ['a'] },
      {
        op: 'or' as const,
        conditions: [
          { field: 'c_ust', operator: 'gt' as const, value: 10 },
          { field: 'name', operator: 'contains' as const, value: 'SEI' },
        ],
      },
    ],
  };

  it('valida a AST e lista campos/ profundidade', () => {
    expect(FilterGroupSchema.parse(filter)).toEqual(filter);
    expect(filterFields(filter).sort()).toEqual(['c_status', 'c_ust', 'name']);
    expect(filterDepth(filter)).toBe(2);
  });

  it('rejeita operadores desconhecidos e chaves extras', () => {
    expect(() =>
      FilterGroupSchema.parse({
        op: 'and',
        conditions: [{ field: 'x', operator: 'like', value: 1 }],
      }),
    ).toThrow();
    expect(() => FilterGroupSchema.parse({ op: 'and', conditions: [], extra: true })).toThrow();
  });
});

describe('ordenação', () => {
  it('interpreta termos e gera assinatura', () => {
    const terms = parseSort('c_ust:desc, name');
    expect(terms).toEqual([
      { field: 'c_ust', direction: 'desc' },
      { field: 'name', direction: 'asc' },
    ]);
    expect(sortSignature(terms)).toBe('c_ust:desc,name:asc');
    expect(sortSignature([])).toBe('position:asc');
  });

  it('rejeita entradas inválidas', () => {
    expect(() => parseSort('Name;drop:asc')).toThrow();
    expect(() => parseSort('a:up')).toThrow();
    expect(() => parseSort('a,b,c,d')).toThrow();
  });
});
