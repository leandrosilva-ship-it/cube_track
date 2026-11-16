'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { EmailSettings, NotificationPreference } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

export function useEmailSettings() {
  return useQuery({
    queryKey: qk.emailSettings(),
    queryFn: () => api<EmailSettings>('/v1/email/settings'),
  });
}

export interface UpdateEmailSettingsInput {
  enabled?: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string | null;
  password?: string | null;
  fromAddress?: string | null;
}

export function useUpdateEmailSettings() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: UpdateEmailSettingsInput) =>
      api<EmailSettings>('/v1/email/settings', { method: 'PATCH', body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.emailSettings(), data);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useSendTestEmail() {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: () => api<{ status: 'queued' }>('/v1/email/settings/test', { method: 'POST' }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

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
