import { describe, expect, it } from 'vitest';

import {
  displayIdPeriodKey,
  formatDisplayId,
  isValidDisplayIdMask,
  toCalendarDate,
} from './display-id.js';

const date = { year: 2026, month: 3, day: 7 };

describe('formatDisplayId', () => {
  it('formata a máscara padrão ano-sequência', () => {
    expect(formatDisplayId('{YYYY}-{SEQ:4}', 924, date)).toBe('2026-0924');
  });

  it('suporta todos os tokens e texto literal', () => {
    expect(formatDisplayId('PMSP/{YY}{MM}{DD}-{SEQ}', 12, date)).toBe('PMSP/260307-12');
  });

  it('não trunca sequências maiores que a largura', () => {
    expect(formatDisplayId('{SEQ:2}', 12345, date)).toBe('12345');
  });

  it('rejeita sequência inválida', () => {
    expect(() => formatDisplayId('{SEQ}', 0, date)).toThrow(RangeError);
  });
});

describe('isValidDisplayIdMask', () => {
  it('exige exatamente um token de sequência', () => {
    expect(isValidDisplayIdMask('{YYYY}-{SEQ:4}')).toBe(true);
    expect(isValidDisplayIdMask('{YYYY}')).toBe(false);
    expect(isValidDisplayIdMask('{SEQ}-{SEQ}')).toBe(false);
    expect(isValidDisplayIdMask('')).toBe(false);
  });
});

describe('displayIdPeriodKey', () => {
  it('gera chaves de período', () => {
    expect(displayIdPeriodKey('never', date)).toBe('');
    expect(displayIdPeriodKey('yearly', date)).toBe('2026');
    expect(displayIdPeriodKey('monthly', date)).toBe('2026-03');
  });
});

describe('toCalendarDate', () => {
  it('converte o instante no fuso de São Paulo', () => {
    expect(toCalendarDate(new Date('2027-01-01T02:00:00Z'))).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
  });
});
