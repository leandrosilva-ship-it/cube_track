'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { Me, Member, NotificationPage, Role } from '@/lib/api/types';
import { qk } from '@/lib/query/keys';
import { useSession } from '@/stores/session';

export function useMe() {
  const enabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.me(),
    queryFn: () => api<Me>('/v1/me'),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useMembers() {
  const enabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.members(),
    queryFn: () => api<{ data: Member[] }>('/v1/members').then((response) => response.data),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useRoles(enabled = true) {
  const authenticated = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.roles(),
    queryFn: () => api<{ data: Role[] }>('/v1/roles').then((response) => response.data),
    enabled: enabled && authenticated,
    staleTime: 10 * 60_000,
  });
}

/** Contagem de não lidas (badge do Inbox); atualizada por `notification.created`. */
export function useUnreadCount() {
  const enabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.unreadCount(),
    queryFn: () =>
      api<NotificationPage>('/v1/me/notifications', { query: { unreadOnly: 'true', limit: 1 } }),
    enabled,
    select: (page) => page.unreadCount,
  });
}
