import { describe, expect, it } from 'vitest';

import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from './format.js';
import { matchLocale } from './locales.js';

const nbsp = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('datas', () => {
  it('data de negócio não muda de dia em nenhum fuso', () => {
    expect(formatDate('2026-03-01', 'pt-BR')).toBe('01/03/2026');
    expect(formatDate('2026-03-01', 'en')).toBe('03/01/2026');
    expect(formatDate('2026-03-01', 'pt-BR', { style: 'long' })).toBe('1 de março de 2026');
    expect(formatDate('2026-03-01', 'pt-BR', { style: 'dayMonth' })).toBe('01 de mar');
  });

  it('instantes usam o fuso informado', () => {
    expect(formatDateTime('2026-03-02T01:30:00Z', 'pt-BR')).toBe('01/03/2026, 22:30');
    expect(formatDate('2026-03-02T01:30:00Z', 'pt-BR', { timeZone: 'UTC' })).toBe('02/03/2026');
  });

  it('tempo relativo', () => {
    const now = new Date('2026-10-14T12:00:00Z');
    expect(formatRelativeTime('2026-10-14T11:55:00Z', 'pt-BR', now)).toBe('há 5 minutos');
    expect(formatRelativeTime('2026-10-15T12:00:00Z', 'pt-BR', now)).toBe('amanhã');
    expect(formatRelativeTime('2026-10-14T11:55:00Z', 'es', now)).toBe('hace 5 minutos');
  });
});

describe('números e moeda', () => {
  it('formata no padrão brasileiro preservando decimais em string', () => {
    expect(formatNumber(1234567.891, 'pt-BR')).toBe('1.234.567,89');
    expect(formatNumber('12345678901234567.25', 'pt-BR')).toBe('12.345.678.901.234.567,25');
    expect(formatNumber('40', 'pt-BR', { minimumFractionDigits: 2 })).toBe('40,00');
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });

  it('moeda em reais por padrão', () => {
    expect(nbsp(formatCurrency('1500.5', 'pt-BR'))).toBe('R$ 1.500,50');
    expect(nbsp(formatCurrency(1500.5, 'en'))).toBe('R$1,500.50');
    expect(nbsp(formatCurrency('10', 'pt-BR', 'USD'))).toBe('US$ 10,00');
  });

  it('percentual e validação', () => {
    expect(nbsp(formatPercent(0.425, 'pt-BR', 1))).toBe('42,5%');
    expect(() => formatNumber('1e9', 'pt-BR')).toThrow(RangeError);
  });
});

describe('idioma', () => {
  it('negocia o Accept-Language', () => {
    expect(matchLocale('en-US,en;q=0.9,pt-BR;q=0.8')).toBe('en');
    expect(matchLocale('es-AR')).toBe('es');
    expect(matchLocale('pt-PT')).toBe('pt-BR');
    expect(matchLocale('fr-FR,de;q=0.5')).toBe('pt-BR');
    expect(matchLocale(null)).toBe('pt-BR');
  });
});
