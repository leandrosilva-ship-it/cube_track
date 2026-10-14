'use client';

import { rooms } from '@cube-track/shared/realtime';

import type { Member } from '@/lib/api/types';
import { useRealtime } from '@/realtime/store';
import { useSession } from '@/stores/session';

import { useMembers } from '../shell/hooks';

export interface PresentPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  viewId: string | null;
}

/** Quem está vendo o board agora (exceto o próprio usuário), com nome e avatar dos membros. */
export function useBoardPresence(boardId: string): PresentPerson[] {
  const tenantId = useSession((state) => state.tenant?.id ?? '');
  const userId = useSession((state) => state.user?.id ?? '');
  const entries = useRealtime((state) => state.presence[rooms.board(tenantId, boardId)]);
  const members = useMembers();
  const byId = new Map<string, Member>(
    (members.data ?? []).map((member) => [member.userId, member]),
  );
  return (entries ?? [])
    .filter((entry) => entry.userId !== userId)
    .map((entry) => {
      const member = byId.get(entry.userId);
      return {
        id: entry.userId,
        name: member?.name ?? '…',
        avatarUrl: member?.avatarUrl ?? null,
        viewId: typeof entry.state.viewId === 'string' ? entry.state.viewId : null,
      };
    });
}
