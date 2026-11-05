import { describe, expect, it } from 'vitest';

import { endOfDayIso, isExpired, toggleScope } from './model';

describe('toggleScope', () => {
  it('adiciona e remove um escopo', () => {
    expect(toggleScope([], 'items:read')).toEqual(['items:read']);
    expect(toggleScope(['items:read'], 'items:read')).toEqual([]);
  });

  it('marcar um escopo de escrita também marca a leitura implícita', () => {
    expect(toggleScope([], 'items:write').sort()).toEqual(['items:read', 'items:write']);
    expect(toggleScope(['boards:read'], 'boards:write').sort()).toEqual(['boards:read', 'boards:write']);
  });

  it('desmarcar um escopo de escrita não mexe na leitura', () => {
    expect(toggleScope(['items:read', 'items:write'], 'items:write')).toEqual(['items:read']);
  });

  it('escopo sem implicação (ex.: automations:manage) alterna normalmente', () => {
    expect(toggleScope([], 'automations:manage')).toEqual(['automations:manage']);
  });
});

describe('isExpired', () => {
  it('nulo nunca expira', () => {
    expect(isExpired(null)).toBe(false);
  });

  it('compara com o instante injetado', () => {
    const now = new Date('2026-06-15T12:00:00.000Z').getTime();
    expect(isExpired('2026-06-15T11:59:59.000Z', now)).toBe(true);
    expect(isExpired('2026-06-15T12:00:00.000Z', now)).toBe(true);
    expect(isExpired('2026-06-15T12:00:01.000Z', now)).toBe(false);
  });
});

describe('endOfDayIso', () => {
  it('monta um instante ISO no fim do dia informado', () => {
    expect(endOfDayIso('2026-12-31')).toBe('2026-12-31T23:59:59.999Z');
  });
});
