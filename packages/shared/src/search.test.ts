import { describe, expect, it } from 'vitest';

import { meiliQuote } from './search.js';

describe('meiliQuote', () => {
  it('envolve o valor em aspas duplas', () => {
    expect(meiliQuote('abc')).toBe('"abc"');
  });

  it('escapa aspas duplas internas', () => {
    expect(meiliQuote('disse "oi"')).toBe('"disse \\"oi\\""');
  });

  it('escapa barras invertidas antes das aspas (ordem importa)', () => {
    expect(meiliQuote('C:\\pasta')).toBe('"C:\\\\pasta"');
  });

  it('string vazia vira só as aspas', () => {
    expect(meiliQuote('')).toBe('""');
  });
});
