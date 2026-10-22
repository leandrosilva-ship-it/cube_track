'use client';

import { TimelineConfigSchema, type TimelineConfig } from '@cube-track/shared';
import { useState } from 'react';

import { useUpdateView } from '../board/hooks';
import type { BoardView } from '@/lib/api/types';

/** Mesmo padrão do `useKanbanConfig`/`useCalendarConfig`: a config é a própria view. */
export function useTimelineConfig(boardId: string, view: BoardView) {
  const update = useUpdateView(boardId);
  const [config, setConfigState] = useState<TimelineConfig>(() =>
    TimelineConfigSchema.parse(view.config),
  );
  const [appliedConfig, setAppliedConfig] = useState(view.config);
  if (appliedConfig !== view.config) {
    setAppliedConfig(view.config);
    setConfigState(TimelineConfigSchema.parse(view.config));
  }

  const setConfig = (patch: Partial<TimelineConfig>) => {
    const next = { ...config, ...patch };
    setConfigState(next);
    update.mutate({ viewId: view.id, input: { config: next } });
  };

  return { config, setConfig, canEdit: view.canEdit && !update.isPending };
}
