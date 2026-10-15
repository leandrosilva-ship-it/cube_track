import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type { BoardColumn, BoardDetail } from '@/lib/api/types';

/**
 * Pedido de preenchimento de campos obrigatórios (ADR 0039): aberto antes de salvar quando a
 * mudança torna colunas obrigatórias (ou quando o servidor responde 422 `required_fields_missing`).
 * A promessa resolve com os valores preenchidos ou `null` se a pessoa cancelar.
 */
export interface RequiredPrompt {
  board: BoardDetail;
  itemName: string;
  columns: BoardColumn[];
  /** Valores que já estão no item/mudança (o diálogo parte deles). */
  initial: Record<string, unknown>;
  resolve: (values: Record<string, Record<string, unknown>> | null) => void;
}

export const requiredPromptStore = createStore<{ prompt: RequiredPrompt | null }>(() => ({
  prompt: null,
}));

export function requestRequiredValues(
  input: Omit<RequiredPrompt, 'resolve'>,
): Promise<Record<string, Record<string, unknown>> | null> {
  return new Promise((resolve) => {
    // Um pedido pendente é cancelado pelo novo (a pessoa já mudou de contexto).
    requiredPromptStore.getState().prompt?.resolve(null);
    requiredPromptStore.setState({
      prompt: {
        ...input,
        resolve: (values) => {
          requiredPromptStore.setState({ prompt: null });
          resolve(values);
        },
      },
    });
  });
}

export function useRequiredPrompt(): RequiredPrompt | null {
  return useStore(requiredPromptStore, (state) => state.prompt);
}
