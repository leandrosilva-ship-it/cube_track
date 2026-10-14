import { describe, expect, it } from 'vitest';

import { accessiblePair, contrastRatio, shade } from './contrast';

describe('accessiblePair', () => {
  it.each([
    '#e2445c',
    '#0086c0',
    '#df2f4a',
    '#a25ddc',
    '#00c875',
    '#ff7575',
    '#9cd326',
    '#bb3354',
    '#ffcb00',
    '#037f4c',
  ])('%s chega a contraste AA mantendo a cor reconhecível', (color) => {
    const pair = accessiblePair(color);
    expect(contrastRatio(pair.background, pair.text)).toBeGreaterThanOrEqual(4.5);
  });

  it('não altera cores que já atingem AA e tolera entradas inválidas', () => {
    expect(accessiblePair('#00c875')).toEqual({ background: '#00c875', text: '#1b1f2e' });
    expect(accessiblePair('vermelho').background).toBe('#c4c4c4');
    expect(shade('#808080', 1)).toBe('#000000');
    expect(shade('#808080', -1)).toBe('#ffffff');
  });
});
