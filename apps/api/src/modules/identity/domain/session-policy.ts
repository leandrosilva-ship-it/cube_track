import type { SessionPolicy } from '@cube-track/shared';

/**
 * Regras puras de aplicação da política de sessão (ADR 0057) — sem acesso a banco, testadas
 * isoladamente. `SessionService` resolve os dados (sessões ativas, `lastSeenAt`) e chama estas funções.
 */

/** Tempo sem uso (desde `lastSeenAt`) excede `idleTimeoutMinutes`? */
export function isSessionIdle(lastSeenAt: Date, policy: SessionPolicy, now: Date = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > policy.idleTimeoutMinutes * 60_000;
}

/** Tempo desde a criação da FAMÍLIA (não da última rotação) excede `absoluteLifetimeHours`? */
export function isSessionBeyondAbsoluteLifetime(
  familyCreatedAt: Date,
  policy: SessionPolicy,
  now: Date = new Date(),
): boolean {
  return now.getTime() - familyCreatedAt.getTime() > policy.absoluteLifetimeHours * 3_600_000;
}

/** Quais sessões (da mais antiga para a mais nova) expulsar para respeitar `maxConcurrentSessions`
 * após uma nova sessão ser emitida — nunca expulsa a recém-criada. */
export function sessionsToEvict(
  activeSessions: readonly { id: string; createdAt: Date }[],
  newSessionId: string,
  policy: SessionPolicy,
): string[] {
  const others = activeSessions.filter((session) => session.id !== newSessionId);
  const excess = others.length + 1 - policy.maxConcurrentSessions;
  if (excess <= 0) return [];
  return others
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, excess)
    .map((session) => session.id);
}
