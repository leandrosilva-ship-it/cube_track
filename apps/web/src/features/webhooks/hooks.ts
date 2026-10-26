'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { Webhook, WebhookWithSecret } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

import type { WebhookInputBody } from './model';

export function useWebhooks(boardId: string) {
  return useQuery({
    queryKey: qk.webhooksOfBoard(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Webhook[] }>(`/v1/boards/${boardId}/webhooks`, { signal })).data,
  });
}

export function useCreateWebhook(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: WebhookInputBody) =>
      api<WebhookWithSecret>(`/v1/boards/${boardId}/webhooks`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.webhooksOfBoard(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateWebhook(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<WebhookInputBody> }) =>
      api<Webhook>(`/v1/webhooks/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.webhooksOfBoard(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useRegenerateWebhookSecret(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) =>
      api<WebhookWithSecret>(`/v1/webhooks/${id}/regenerate-secret`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.webhooksOfBoard(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteWebhook(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.webhooksOfBoard(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
