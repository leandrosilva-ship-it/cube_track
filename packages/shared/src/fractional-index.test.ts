import { describe, expect, it } from 'vitest';

import {
  comparePositions,
  initialPositions,
  positionBetween,
  positionsBetween,
} from './fractional-index.js';

describe('fractional index', () => {
  it('gera posições ordenadas', () => {
    const keys = initialPositions(50);
    expect([...keys].sort(comparePositions)).toEqual(keys);
    expect(new Set(keys).size).toBe(50);
  });

  it('insere entre vizinhos sem renumerar', () => {
    const [a, b] = initialPositions(2) as [string, string];
    const middle = positionBetween(a, b);
    expect(comparePositions(a, middle)).toBe(-1);
    expect(comparePositions(middle, b)).toBe(-1);
  });

  it('suporta muitas inserções consecutivas no mesmo ponto', () => {
    let left = positionBetween(null, null);
    const right = positionBetween(left, null);
    for (let index = 0; index < 200; index += 1) {
      const next = positionBetween(left, right);
      expect(comparePositions(left, next)).toBe(-1);
      expect(comparePositions(next, right)).toBe(-1);
      left = next;
    }
  });

  it('gera lotes entre chaves existentes', () => {
    const [a, b] = initialPositions(2) as [string, string];
    const batch = positionsBetween(a, b, 10);
    expect(
      [a, ...batch, b].every(
        (key, i, all) => i === 0 || comparePositions(all[i - 1] ?? '', key) === -1,
      ),
    ).toBe(true);
  });
});
