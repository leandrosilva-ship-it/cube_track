import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type { ItemListParams } from '@/lib/query/keys';

export interface BoardViewState extends ItemListParams {
  /** Colunas ocultas (a configuração salva por view chega no Prompt 6). */
  hiddenColumnKeys: string[];
  /** Níveis de agrupamento (até 3): `group` ou chaves de coluna. */
  groupBy: string[];
  /** Ordem das colunas definida arrastando os cabeçalhos. */
  columnOrder?: string[];
  /** Larguras ajustadas pelo usuário (px). */
  columnWidths?: Record<string, number>;
  /** Colunas fixadas à esquerda (além do nome). */
  pinnedColumnKeys?: string[];
  /** Baldes recolhidos (caminho `nível=chave/...`). */
  collapsed?: string[];
}

const DEFAULT_STATE: BoardViewState = { hiddenColumnKeys: [], groupBy: ['group'] };

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
    const {
      search: _search,
      personId: _personId,
      statusLabelIds: _statusLabelIds,
      filter: _filter,
      ...layout
    } = current;
    return { [boardId]: layout };
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
    ...((state.filter?.conditions.length ?? 0) === 0 ? {} : { filter: state.filter }),
    ...(state.sort === undefined ? {} : { sort: state.sort }),
  };
}
