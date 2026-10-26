'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { Phase, Pipe, ProcessConfig, Sla, SlaTracker, TransitionRule } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

import type {
  PhaseInputBody,
  PipeInputBody,
  SlaInputBody,
  TransitionRuleInputBody,
} from './model';

// ---------------------------------------------------------------------------------- leitura ---

export function useProcessConfig(boardId: string, enabled = true) {
  return useQuery({
    queryKey: qk.processConfig(boardId),
    queryFn: ({ signal }) => api<ProcessConfig>(`/v1/boards/${boardId}/process`, { signal }),
    enabled,
  });
}

export function useSlas(boardId: string) {
  return useQuery({
    queryKey: qk.slas(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Sla[] }>(`/v1/boards/${boardId}/slas`, { signal })).data,
  });
}

export function useSlaTrackers(boardId: string, enabled = true) {
  return useQuery({
    queryKey: qk.slaTrackers(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: SlaTracker[] }>(`/v1/boards/${boardId}/sla-trackers`, { signal })).data,
    refetchInterval: 60_000,
    enabled,
  });
}

// ------------------------------------------------------------------------------------- pipe ---

export function useCreatePipe(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: PipeInputBody) =>
      api<Pipe>(`/v1/boards/${boardId}/pipe`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdatePipe(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PipeInputBody> }) =>
      api<Pipe>(`/v1/pipes/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeletePipe(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/pipes/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------------------------ fases ---

export function useCreatePhase(boardId: string, pipeId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: PhaseInputBody) =>
      api<Phase>(`/v1/pipes/${pipeId}/phases`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdatePhase(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PhaseInputBody> }) =>
      api<Phase>(`/v1/phases/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeletePhase(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/phases/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ---------------------------------------------------------------------- regras de transição ---

export function useCreateTransitionRule(boardId: string, pipeId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: TransitionRuleInputBody) =>
      api<TransitionRule>(`/v1/pipes/${pipeId}/transitions`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateTransitionRule(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TransitionRuleInputBody> }) =>
      api<TransitionRule>(`/v1/transitions/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteTransitionRule(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/transitions/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.processConfig(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------------------------- SLAs ---

export function useCreateSla(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: SlaInputBody) =>
      api<Sla>(`/v1/boards/${boardId}/slas`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.slas(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateSla(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<SlaInputBody> }) =>
      api<Sla>(`/v1/slas/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.slas(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteSla(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/slas/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.slas(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
