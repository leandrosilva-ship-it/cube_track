import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Desfazer/refazer por board (Ctrl+Z / Ctrl+Shift+Z ou Ctrl+Y). Cada entrada guarda as operações
 * inversas como chamadas à API — o servidor continua sendo o árbitro (LWW, permissões, auditoria),
 * e outras pessoas recebem o desfazer em tempo real como qualquer outra edição.
 */

export interface UndoEntry {
  /** Rótulo exibido no aviso ("Desfeito: Status de 3 itens"). */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface UndoState {
  past: Record<string, UndoEntry[]>;
  future: Record<string, UndoEntry[]>;
  busy: boolean;
}

export const UNDO_LIMIT = 50;

export const undoStore = createStore<UndoState>(() => ({ past: {}, future: {}, busy: false }));

export function pushUndo(boardId: string, entry: UndoEntry): void {
  undoStore.setState((state) => ({
    past: { ...state.past, [boardId]: [...(state.past[boardId] ?? []), entry].slice(-UNDO_LIMIT) },
    future: { ...state.future, [boardId]: [] },
  }));
}

async function step(boardId: string, direction: 'undo' | 'redo'): Promise<UndoEntry | null> {
  const state = undoStore.getState();
  if (state.busy) return null;
  const source = direction === 'undo' ? state.past : state.future;
  const stack = source[boardId] ?? [];
  const entry = stack.at(-1);
  if (entry === undefined) return null;
  undoStore.setState({ busy: true });
  try {
    await (direction === 'undo' ? entry.undo() : entry.redo());
    undoStore.setState((current) => {
      const from = direction === 'undo' ? current.past : current.future;
      const to = direction === 'undo' ? current.future : current.past;
      return {
        busy: false,
        ...(direction === 'undo'
          ? {
              past: { ...from, [boardId]: (from[boardId] ?? []).slice(0, -1) },
              future: { ...to, [boardId]: [...(to[boardId] ?? []), entry] },
            }
          : {
              future: { ...from, [boardId]: (from[boardId] ?? []).slice(0, -1) },
              past: { ...to, [boardId]: [...(to[boardId] ?? []), entry] },
            }),
      };
    });
    return entry;
  } catch (error) {
    // A operação inversa falhou (ex.: item excluído por outra pessoa): descarta a entrada.
    undoStore.setState((current) => {
      const from = direction === 'undo' ? current.past : current.future;
      const key = direction === 'undo' ? 'past' : 'future';
      return { busy: false, [key]: { ...from, [boardId]: (from[boardId] ?? []).slice(0, -1) } };
    });
    throw error;
  }
}

export const undo = (boardId: string) => step(boardId, 'undo');
export const redo = (boardId: string) => step(boardId, 'redo');

export function clearUndo(boardId: string): void {
  undoStore.setState((state) => ({
    past: { ...state.past, [boardId]: [] },
    future: { ...state.future, [boardId]: [] },
  }));
}

export function useUndoAvailability(boardId: string): { canUndo: boolean; canRedo: boolean } {
  const canUndo = useStore(undoStore, (state) => (state.past[boardId]?.length ?? 0) > 0);
  const canRedo = useStore(undoStore, (state) => (state.future[boardId]?.length ?? 0) > 0);
  return { canUndo, canRedo };
}
