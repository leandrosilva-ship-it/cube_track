import type { SessionResponse } from '@/lib/api/types';
import { clearRecentBoards } from '@/lib/recent-boards';
import { applySession, clearSession, sessionStore } from '@/stores/session';

const CHANNEL = 'ct-auth';
const REFRESH_LOCK = 'ct-auth-refresh';
/** Renova o access token 60 s antes de expirar. */
const REFRESH_MARGIN_MS = 60_000;

type AuthMessage = { type: 'signed-out' } | { type: 'session-changed'; sessionId: string };

let inflight: Promise<boolean> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(message: AuthMessage) => void>();

function broadcast(message: AuthMessage): void {
  channel?.postMessage(message);
}

/** Escuta eventos de autenticação de outras abas (logout, troca de organização). */
export function onAuthBroadcast(listener: (message: AuthMessage) => void): () => void {
  if (channel === null && typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<AuthMessage>) => {
      listeners.forEach((entry) => {
        entry(event.data);
      });
    };
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function schedule(): void {
  if (timer !== undefined) clearTimeout(timer);
  const { expiresAt, status } = sessionStore.getState();
  if (status !== 'authenticated') return;
  const delay = Math.max(5_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
  timer = setTimeout(() => {
    void refreshSession();
  }, delay);
}

/** Aplica uma sessão recém-emitida (login, MFA, convite, troca de organização). */
export function establishSession(session: SessionResponse, notifyOtherTabs = true): void {
  applySession(session);
  schedule();
  if (notifyOtherTabs) broadcast({ type: 'session-changed', sessionId: session.sessionId });
}

async function requestRefresh(): Promise<boolean> {
  const response = await fetch('/v1/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
  });
  if (!response.ok) return false;
  establishSession((await response.json()) as SessionResponse, false);
  return true;
}

/**
 * Renova a sessão com o cookie HttpOnly. Single-flight na aba e serializada entre abas (Web Locks):
 * o refresh token é rotativo e duas renovações simultâneas com o mesmo cookie seriam tratadas como
 * reutilização (revogação da família).
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      const run = () => requestRefresh();
      const ok =
        typeof navigator !== 'undefined' && 'locks' in navigator
          ? await navigator.locks.request(REFRESH_LOCK, run)
          : await run();
      if (!ok) clearSession();
      return ok;
    } catch {
      // Falha de rede: mantém o estado atual e tenta de novo no próximo uso.
      if (sessionStore.getState().status === 'unknown') clearSession();
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Primeira carga: tenta recuperar a sessão a partir do cookie. */
export async function bootstrapSession(): Promise<boolean> {
  const { status } = sessionStore.getState();
  if (status === 'authenticated') return true;
  return refreshSession();
}

export async function signOut(): Promise<void> {
  if (timer !== undefined) clearTimeout(timer);
  const token = sessionStore.getState().accessToken;
  try {
    await fetch('/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: '{}',
    });
  } finally {
    clearSession();
    clearRecentBoards();
    broadcast({ type: 'signed-out' });
  }
}

/** Uso em testes: encerra timers e estado do módulo. */
export function resetAuthModule(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  inflight = null;
}
