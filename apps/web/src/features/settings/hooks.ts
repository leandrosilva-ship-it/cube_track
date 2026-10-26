'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { NotificationPreference } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

export function useNotificationPreferences() {
  return useQuery({
    queryKey: qk.notificationPreferences(),
    queryFn: async ({ signal }) =>
      (await api<{ data: NotificationPreference[] }>('/v1/me/notification-preferences', { signal }))
        .data,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (
      preferences: {
        channel: 'in_app' | 'email' | 'push';
        eventType: string;
        enabled: boolean;
        frequency: 'instant' | 'hourly' | 'daily' | 'never';
      }[],
    ) =>
      api<{ data: NotificationPreference[] }>('/v1/me/notification-preferences', {
        method: 'PUT',
        body: { preferences },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.notificationPreferences(), result.data);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
