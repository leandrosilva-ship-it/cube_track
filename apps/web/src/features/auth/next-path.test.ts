import { describe, expect, it } from 'vitest';

import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it.each([
    ['/w/1/b/2?view=x', '/w/1/b/2?view=x'],
    ['/', '/'],
  ])('aceita caminho interno %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['https://evil.com'],
    ['//evil.com'],
    ['/\\evil.com'],
    ['javascript:alert(1)'],
    ['/ok\n//evil'],
    ['/\u0000x'],
  ])('rejeita %j (open redirect)', (raw) => {
    expect(safeNextPath(raw, '/inicio')).toBe('/inicio');
  });
});
