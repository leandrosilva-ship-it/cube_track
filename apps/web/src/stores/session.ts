import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type { SessionResponse, SessionTenant, SessionUser } from '@/lib/api/types';

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  /** Epoch (ms) em que o access token expira. */
  expiresAt: number;
  sessionId: string | null;
  user: SessionUser | null;
  tenant: SessionTenant | null;
}

const initial: SessionState = {
  status: 'unknown',
  accessToken: null,
  expiresAt: 0,
  sessionId: null,
  user: null,
  tenant: null,
};

/**
 * Sessão em memória (o access token nunca vai para localStorage — mitigação de XSS). O refresh token
 * fica em cookie HttpOnly com path `/v1/auth`, acessível só ao servidor (ADR 0032).
 */
export const sessionStore = createStore<SessionState>(() => initial);

export function applySession(session: SessionResponse, now = Date.now()): void {
  sessionStore.setState({
    status: 'authenticated',
    accessToken: session.accessToken,
    expiresAt: now + session.expiresIn * 1000,
    sessionId: session.sessionId,
    user: session.user,
    tenant: session.tenant,
  });
}

export function clearSession(): void {
  sessionStore.setState({ ...initial, status: 'anonymous' });
}

export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(sessionStore, selector);
}
