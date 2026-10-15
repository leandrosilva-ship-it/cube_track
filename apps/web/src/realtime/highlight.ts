import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/** Quanto tempo uma célula alterada por outra pessoa fica destacada. */
export const HIGHLIGHT_MS = 2_500;

interface HighlightState {
  /** `itemId:campo` → instante em que o destaque expira. */
  cells: Record<string, number>;
}

export const highlightStore = createStore<HighlightState>(() => ({ cells: {} }));

const cellKey = (itemId: string, field: string) => `${itemId}:${field}`;

/**
 * Marca células alteradas remotamente (eco realtime de outra pessoa/aba). O destaque some sozinho;
 * usuários com `prefers-reduced-motion` veem só a borda, sem animação (CSS).
 */
export function markRemoteChanges(
  itemId: string,
  fields: readonly string[],
  now: number = Date.now(),
): void {
  if (fields.length === 0) return;
  const expiresAt = now + HIGHLIGHT_MS;
  highlightStore.setState((state) => {
    const cells = { ...state.cells };
    for (const field of fields) cells[cellKey(itemId, field)] = expiresAt;
    return { cells };
  });
  setTimeout(() => {
    highlightStore.setState((state) => {
      const cells = { ...state.cells };
      let changed = false;
      for (const field of fields) {
        const key = cellKey(itemId, field);
        if ((cells[key] ?? 0) <= expiresAt) {
          Reflect.deleteProperty(cells, key);
          changed = true;
        }
      }
      return changed ? { cells } : state;
    });
  }, HIGHLIGHT_MS);
}

export function isHighlighted(itemId: string, field: string): boolean {
  return (highlightStore.getState().cells[cellKey(itemId, field)] ?? 0) > Date.now();
}

export function useCellHighlight(itemId: string, field: string): boolean {
  return useStore(highlightStore, (state) => state.cells[cellKey(itemId, field)] !== undefined);
}
