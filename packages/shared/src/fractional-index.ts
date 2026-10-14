import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Ordenação manual por fractional indexing (ADR 0013).
 * As chaves são strings base-62 comparáveis byte a byte (`COLLATE "C"` no banco).
 */

/** Gera uma posição estritamente entre `before` e `after` (null = extremidade). */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** Gera `count` posições ordenadas entre `before` e `after`. */
export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  return generateNKeysBetween(before, after, count);
}

/** Gera `count` posições sequenciais a partir do início de uma lista vazia. */
export function initialPositions(count: number): string[] {
  return generateNKeysBetween(null, null, count);
}

/** Comparador compatível com a ordenação `COLLATE "C"` do PostgreSQL. */
export function comparePositions(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
