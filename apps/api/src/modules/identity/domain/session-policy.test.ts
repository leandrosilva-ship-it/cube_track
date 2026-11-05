import { DEFAULT_SESSION_POLICY, SessionPolicySchema } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import { isSessionBeyondAbsoluteLifetime, isSessionIdle, sessionsToEvict } from './session-policy.js';

describe('isSessionIdle', () => {
  it('compara contra idleTimeoutMinutes', () => {
    const policy = SessionPolicySchema.parse({ idleTimeoutMinutes: 30 });
    const now = new Date('2026-01-01T12:00:00Z');
    expect(isSessionIdle(new Date('2026-01-01T11:00:00Z'), policy, now)).toBe(true);
    expect(isSessionIdle(new Date('2026-01-01T11:45:00Z'), policy, now)).toBe(false);
  });
});

describe('isSessionBeyondAbsoluteLifetime', () => {
  it('compara contra absoluteLifetimeHours desde a criação da família', () => {
    const policy = SessionPolicySchema.parse({ absoluteLifetimeHours: 24 });
    const now = new Date('2026-01-03T00:00:00Z');
    expect(isSessionBeyondAbsoluteLifetime(new Date('2026-01-01T00:00:00Z'), policy, now)).toBe(true);
    expect(isSessionBeyondAbsoluteLifetime(new Date('2026-01-02T12:00:00Z'), policy, now)).toBe(false);
  });
});

describe('sessionsToEvict', () => {
  it('nunca expulsa a sessão recém-criada', () => {
    const policy = SessionPolicySchema.parse({ maxConcurrentSessions: 1 });
    const evicted = sessionsToEvict(
      [{ id: 'old', createdAt: new Date('2026-01-01') }],
      'old',
      policy,
    );
    expect(evicted).toEqual([]);
  });

  it('expulsa as mais antigas até respeitar o limite', () => {
    const policy = SessionPolicySchema.parse({ maxConcurrentSessions: 2 });
    const sessions = [
      { id: 'a', createdAt: new Date('2026-01-01') },
      { id: 'b', createdAt: new Date('2026-01-02') },
      { id: 'new', createdAt: new Date('2026-01-03') },
    ];
    expect(sessionsToEvict(sessions, 'new', policy)).toEqual(['a']);
  });

  it('dentro do limite não expulsa ninguém', () => {
    const sessions = [{ id: 'a', createdAt: new Date('2026-01-01') }, { id: 'new', createdAt: new Date() }];
    expect(sessionsToEvict(sessions, 'new', DEFAULT_SESSION_POLICY)).toEqual([]);
  });
});
