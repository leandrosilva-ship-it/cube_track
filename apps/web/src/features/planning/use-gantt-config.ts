'use client';

import { GanttConfigSchema, type GanttConfig } from '@cube-track/shared';
import { useState } from 'react';

import { useUpdateView } from '../board/hooks';
import type { BoardView } from '@/lib/api/types';

/** Mesmo padrão do `useKanbanConfig`/`useCalendarConfig`/`useTimelineConfig`. */
export function useGanttConfig(boardId: string, view: BoardView) {
  const update = useUpdateView(boardId);
  const [config, setConfigState] = useState<GanttConfig>(() => GanttConfigSchema.parse(view.config));
  const [appliedConfig, setAppliedConfig] = useState(view.config);
  if (appliedConfig !== view.config) {
    setAppliedConfig(view.config);
    setConfigState(GanttConfigSchema.parse(view.config));
  }

  const setConfig = (patch: Partial<GanttConfig>) => {
    const next = { ...config, ...patch };
    setConfigState(next);
    update.mutate({ viewId: view.id, input: { config: next } });
  };

  return { config, setConfig, canEdit: view.canEdit && !update.isPending };
}
