'use client';

import { KanbanConfigSchema, type KanbanConfig } from '@cube-track/shared';
import { useState } from 'react';

import { useUpdateView } from '../board/hooks';
import type { BoardView } from '@/lib/api/types';

/**
 * Config do Kanban desta view: inicializa do que já veio salvo (`parseViewConfig` no servidor
 * sempre devolve um `KanbanConfig` completo) e persiste cada mudança de imediato — não é um
 * rascunho local, é a própria configuração da view (ADR 0044).
 */
export function useKanbanConfig(boardId: string, view: BoardView) {
  const update = useUpdateView(boardId);
  const [config, setConfigState] = useState<KanbanConfig>(() =>
    KanbanConfigSchema.parse(view.config),
  );
  // Rastreia a referência de `view.config` já aplicada: o Query reusa a referência quando o
  // conteúdo não muda (structural sharing), então isso só reage a mudanças de verdade vindas do
  // servidor (ex.: outra pessoa editou a mesma view compartilhada) — ajuste em tempo de render,
  // sem efeito (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [appliedConfig, setAppliedConfig] = useState(view.config);
  if (appliedConfig !== view.config) {
    setAppliedConfig(view.config);
    setConfigState(KanbanConfigSchema.parse(view.config));
  }

  const setConfig = (patch: Partial<KanbanConfig>) => {
    const next = { ...config, ...patch };
    setConfigState(next);
    update.mutate({ viewId: view.id, input: { config: next } });
  };

  return { config, setConfig, canEdit: view.canEdit && !update.isPending };
}
