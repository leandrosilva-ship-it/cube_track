/**
 * Mutações otimistas em andamento nesta aba (`X-Client-Mutation-Id`). O eco realtime de uma mutação
 * pendente é ignorado — a resposta HTTP confirma ou desfaz o patch (ADR 0033).
 */
const pending = new Set<string>();

export function trackMutation(id: string): void {
  pending.add(id);
}

export function releaseMutation(id: string): void {
  // Pequeno atraso: o eco pode chegar logo depois da resposta HTTP.
  setTimeout(() => pending.delete(id), 5_000);
}

export function isPendingMutation(id: string | null): boolean {
  return id !== null && pending.has(id);
}
