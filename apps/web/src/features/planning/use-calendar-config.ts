'use client';

import { CalendarConfigSchema, type CalendarConfig } from '@cube-track/shared';
import { useState } from 'react';

import { useUpdateView } from '../board/hooks';
import type { BoardView } from '@/lib/api/types';

/** Mesmo padrão do `useKanbanConfig`: a config é a própria view, persistida a cada mudança. */
export function useCalendarConfig(boardId: string, view: BoardView) {
  const update = useUpdateView(boardId);
  const [config, setConfigState] = useState<CalendarConfig>(() =>
    CalendarConfigSchema.parse(view.config),
  );
  const [appliedConfig, setAppliedConfig] = useState(view.config);
  if (appliedConfig !== view.config) {
    setAppliedConfig(view.config);
    setConfigState(CalendarConfigSchema.parse(view.config));
  }

  const setConfig = (patch: Partial<CalendarConfig>) => {
    const next = { ...config, ...patch };
    setConfigState(next);
    update.mutate({ viewId: view.id, input: { config: next } });
  };

  return { config, setConfig, canEdit: view.canEdit && !update.isPending };
}
