import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';

export interface PresenceEntry {
  userId: string;
  state: Record<string, unknown>;
}

export interface RealtimeState {
  status: ConnectionStatus;
  /** Presença por room do servidor (`t:{tenant}:b:{board}`). */
  presence: Record<string, PresenceEntry[]>;
}

export const realtimeStore = createStore<RealtimeState>(() => ({ status: 'idle', presence: {} }));

export function useRealtime<T>(selector: (state: RealtimeState) => T): T {
  return useStore(realtimeStore, selector);
}

export function setPresence(room: string, entries: PresenceEntry[]): void {
  realtimeStore.setState((state) => ({ presence: { ...state.presence, [room]: entries } }));
}

export function upsertPresence(room: string, entry: PresenceEntry): void {
  realtimeStore.setState((state) => {
    const current = state.presence[room] ?? [];
    const others = current.filter((existing) => existing.userId !== entry.userId);
    return { presence: { ...state.presence, [room]: [...others, entry] } };
  });
}

export function removePresence(room: string, userId: string): void {
  realtimeStore.setState((state) => {
    const current = state.presence[room];
    if (current === undefined) return state;
    return {
      presence: { ...state.presence, [room]: current.filter((entry) => entry.userId !== userId) },
    };
  });
}

export function clearRoomPresence(room: string): void {
  realtimeStore.setState((state) => {
    const next = { ...state.presence };
    Reflect.deleteProperty(next, room);
    return { presence: next };
  });
}
