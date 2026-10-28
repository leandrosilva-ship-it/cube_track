'use client';

import { WorkloadViewConfigSchema, type WorkloadViewConfig } from '@cube-track/shared';
import { useState } from 'react';

import { useUpdateView } from '../board/hooks';
import type { BoardView } from '@/lib/api/types';

/** Mesmo padrão do `useCalendarConfig`: a config é a própria view, persistida a cada mudança. */
export function useWorkloadConfig(boardId: string, view: BoardView) {
  const update = useUpdateView(boardId);
  const [config, setConfigState] = useState<WorkloadViewConfig>(() =>
    WorkloadViewConfigSchema.parse(view.config),
  );
  const [appliedConfig, setAppliedConfig] = useState(view.config);
  if (appliedConfig !== view.config) {
    setAppliedConfig(view.config);
    setConfigState(WorkloadViewConfigSchema.parse(view.config));
  }

  const setConfig = (patch: Partial<WorkloadViewConfig>) => {
    const next = { ...config, ...patch };
    setConfigState(next);
    update.mutate({ viewId: view.id, input: { config: next } });
  };

  return { config, setConfig, canEdit: view.canEdit && !update.isPending };
}
