'use client';

import { rooms } from '@cube-track/shared/realtime';

import type { Member } from '@/lib/api/types';
import { useRealtime } from '@/realtime/store';
import { useSession } from '@/stores/session';

import { useMembers } from '../shell/hooks';
import type { PresentPerson } from '../board/presence';

/** Quem está vendo o item agora (exceto o próprio usuário) — painel aberto na mesma room. */
export function useItemPresence(itemId: string): PresentPerson[] {
  const tenantId = useSession((state) => state.tenant?.id ?? '');
  const userId = useSession((state) => state.user?.id ?? '');
  const entries = useRealtime((state) => state.presence[rooms.item(tenantId, itemId)]);
  const members = useMembers();
  const byId = new Map<string, Member>((members.data ?? []).map((member) => [member.userId, member]));
  return (entries ?? [])
    .filter((entry) => entry.userId !== userId)
    .map((entry) => {
      const member = byId.get(entry.userId);
      return {
        id: entry.userId,
        name: member?.name ?? '…',
        avatarUrl: member?.avatarUrl ?? null,
        viewId: null,
      };
    });
}
