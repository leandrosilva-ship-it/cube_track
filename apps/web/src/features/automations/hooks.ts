'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { Automation } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

import type { AutomationInputBody } from './model';

export function useAutomations(boardId: string) {
  return useQuery({
    queryKey: qk.automations(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Automation[] }>(`/v1/boards/${boardId}/automations`, { signal })).data,
  });
}

export function useCreateAutomation(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: AutomationInputBody) =>
      api<Automation>(`/v1/boards/${boardId}/automations`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.automations(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateAutomation(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AutomationInputBody> }) =>
      api<Automation>(`/v1/automations/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.automations(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteAutomation(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/automations/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.automations(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDuplicateAutomation(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) =>
      api<Automation>(`/v1/automations/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.automations(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
