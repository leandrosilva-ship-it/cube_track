import { describe, expect, it } from 'vitest';

import { ConflictError } from '../../../core/errors/problems.js';
import { assertSeatLimit } from './seat-limit.js';

describe('assertSeatLimit (ADR 0059)', () => {
  it('não lança quando ainda cabe mais uma vaga no limite do plano Free (5)', () => {
    expect(() => { assertSeatLimit('free', 4); }).not.toThrow();
  });

  it('lança ConflictError 409 (seat_limit_exceeded) ao atingir o limite do plano Free', () => {
    expect(() => { assertSeatLimit('free', 5); }).toThrow(ConflictError);
    try {
      assertSeatLimit('free', 5);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const conflict = error as ConflictError;
      expect(conflict.status).toBe(409);
      expect(conflict.code).toBe('seat_limit_exceeded');
      expect(conflict.extensions).toMatchObject({ plan: 'free', maxSeats: 5, currentSeats: 5 });
    }
  });

  it('respeita `additional` (ex.: convite em lote de 3 vagas de uma vez)', () => {
    expect(() => { assertSeatLimit('free', 3, 2); }).not.toThrow();
    expect(() => { assertSeatLimit('free', 4, 2); }).toThrow(ConflictError);
  });

  it('nunca lança para Enterprise (sem limite de vagas)', () => {
    expect(() => { assertSeatLimit('enterprise', 10_000); }).not.toThrow();
  });

  it('plano Business (100 vagas): limite mais alto que Free/Pro', () => {
    expect(() => { assertSeatLimit('business', 99); }).not.toThrow();
    expect(() => { assertSeatLimit('business', 100); }).toThrow(ConflictError);
  });
});
