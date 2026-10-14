'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';

import { preferencesStore, updatePreferences } from '@/stores/preferences';

import { useWorkspaces } from './hooks';

/**
 * Workspace atual: o da URL (`/w/[workspaceId]`), senão o último usado, senão o primeiro acessível.
 * O escolhido é lembrado para restaurar a navegação.
 */
export function useCurrentWorkspaceId(): string | null {
  const params = useParams<{ workspaceId?: string }>();
  const workspaces = useWorkspaces();
  const fromUrl = params.workspaceId ?? null;
  const remembered = preferencesStore.getState().lastWorkspaceId;
  const list = workspaces.data ?? [];
  const current =
    fromUrl ??
    (list.some((workspace) => workspace.id === remembered) ? remembered : (list[0]?.id ?? null));

  useEffect(() => {
    if (current !== null && current !== preferencesStore.getState().lastWorkspaceId) {
      updatePreferences({ lastWorkspaceId: current });
    }
  }, [current]);

  return current;
}
