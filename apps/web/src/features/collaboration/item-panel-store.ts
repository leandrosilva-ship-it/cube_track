import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Lista ordenada de itens visíveis na view atual, publicada pela Tabela/Kanban. O painel do item
 * usa isso para "anterior"/"próximo" sem acoplar-se à implementação de cada view.
 */
const orderStore = createStore<Record<string, string[]>>(() => ({}));

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function setItemPanelOrder(boardId: string, itemIds: readonly string[]): void {
  orderStore.setState((state) => {
    const current = state[boardId];
    if (current !== undefined && sameOrder(current, itemIds)) return state;
    return { ...state, [boardId]: [...itemIds] };
  });
}

export function useItemPanelOrder(boardId: string): readonly string[] {
  return useStore(orderStore, (state) => state[boardId] ?? EMPTY);
}

const EMPTY: readonly string[] = [];

export function neighborsOf(
  order: readonly string[],
  itemId: string,
): { prev: string | null; next: string | null } {
  const index = order.indexOf(itemId);
  if (index === -1) return { prev: null, next: null };
  return { prev: order[index - 1] ?? null, next: order[index + 1] ?? null };
}
