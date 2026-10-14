import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type { ItemListParams } from '@/lib/query/keys';

export interface BoardViewState extends ItemListParams {
  /** Colunas ocultas nesta sessão (a view salva com colunas ocultas chega no Prompt 6). */
  hiddenColumnKeys: string[];
  /** `group` ou a chave de uma coluna de status. */
  groupBy: string;
}

const DEFAULT_STATE: BoardViewState = { hiddenColumnKeys: [], groupBy: 'group' };

/** Estado de UI da barra de ferramentas por board (Zustand, efêmero). */
export const boardViewStore = createStore<Record<string, BoardViewState>>(() => ({}));

export function useBoardViewState(boardId: string): BoardViewState {
  return useStore(boardViewStore, (state) => state[boardId] ?? DEFAULT_STATE);
}

/** `undefined` em um campo remove o filtro/ordenação correspondente. */
export type BoardViewPatch = { [K in keyof BoardViewState]?: BoardViewState[K] | undefined };

export function updateBoardView(boardId: string, patch: BoardViewPatch): void {
  boardViewStore.setState((state) => {
    const next: Record<string, unknown> = { ...(state[boardId] ?? DEFAULT_STATE) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) Reflect.deleteProperty(next, key);
      else next[key] = value;
    }
    return { [boardId]: next as unknown as BoardViewState };
  });
}

export function resetBoardFilters(boardId: string): void {
  boardViewStore.setState((state) => {
    const current = state[boardId] ?? DEFAULT_STATE;
    return { [boardId]: { hiddenColumnKeys: current.hiddenColumnKeys, groupBy: current.groupBy } };
  });
}

/** Parâmetros que afetam a consulta no servidor (chave do cache). */
export function listParams(state: BoardViewState): ItemListParams {
  return {
    ...(state.search === undefined || state.search.trim() === ''
      ? {}
      : { search: state.search.trim() }),
    ...(state.personId === undefined ? {} : { personId: state.personId }),
    ...((state.statusLabelIds?.length ?? 0) === 0 ? {} : { statusLabelIds: state.statusLabelIds }),
    ...(state.sort === undefined ? {} : { sort: state.sort }),
  };
}
