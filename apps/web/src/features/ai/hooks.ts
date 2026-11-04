'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  AiAgent,
  AiAgentRun,
  AiAssistantResponse,
  AiPredictions,
  AiSettings,
  AiUsageEntry,
  Item,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

/**
 * Dados de IA (ADR 0055): configuração/uso do tenant (`ai.manage`), recursos de board/item
 * (`ai.use`) e agentes/aprovações (`ai.agents.manage`/`ai.agents.approve`). Mesmo padrão das demais
 * features (TanStack Query + `qk.*`, mutações invalidam a chave correspondente e mostram erro via
 * `toast`) — ver `features/automations/hooks.ts`.
 */

// ----------------------------------------------------------------------- configuração (tenant) ---

export function useAiSettings() {
  return useQuery({ queryKey: qk.aiSettings(), queryFn: () => api<AiSettings>('/v1/ai/settings') });
}

export interface UpdateAiSettingsInput {
  provider?: 'anthropic';
  apiKey?: string;
  model?: string;
  enabled?: boolean;
  monthlyTokenLimit?: number | null;
  monthlyCostLimitCents?: number | null;
}

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: UpdateAiSettingsInput) =>
      api<AiSettings>('/v1/ai/settings', { method: 'PATCH', body: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.aiSettings(), data);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useAiUsage() {
  return useQuery({
    queryKey: qk.aiUsage(),
    queryFn: () => api<{ data: AiUsageEntry[] }>('/v1/ai/settings/usage').then((response) => response.data),
  });
}

// -------------------------------------------------------------------------- recursos de board ---

export function useAskAssistant(boardId: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (question: string) =>
      api<AiAssistantResponse>(`/v1/boards/${boardId}/ai/assistant`, { method: 'POST', body: { question } }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useCreateItemFromText(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { text: string; groupId?: string }) =>
      api<{ item: Item; skippedColumns: string[] }>(`/v1/boards/${boardId}/ai/create-item`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.items(boardId) });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function usePredictions(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.aiPredictions(boardId),
    queryFn: () => api<AiPredictions>(`/v1/boards/${boardId}/ai/predictions`),
    enabled,
  });
}

// --------------------------------------------------------------------------- recursos de item ---

export function useSummarizeItemUpdates(itemId: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: () => api<{ summary: string }>(`/v1/items/${itemId}/ai/summary`, { method: 'POST' }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useGenerateDescription(itemId: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: () =>
      api<{ description: string }>(`/v1/items/${itemId}/ai/generate-description`, { method: 'POST' }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

// --------------------------------------------------------------------------------- agentes IA ---

export interface AiAgentInputBody {
  name: string;
  instructions: string;
  trigger: { type: string; config: Record<string, unknown> };
  allowedActions: string[];
  isActive?: boolean;
}

export function useAiAgents(boardId: string, enabled = true) {
  return useQuery({
    queryKey: qk.aiAgents(boardId),
    queryFn: () => api<{ data: AiAgent[] }>(`/v1/boards/${boardId}/ai-agents`).then((response) => response.data),
    enabled,
  });
}

export function useCreateAiAgent(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: AiAgentInputBody) =>
      api<AiAgent>(`/v1/boards/${boardId}/ai-agents`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.aiAgents(boardId) }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useUpdateAiAgent(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AiAgentInputBody> }) =>
      api<AiAgent>(`/v1/ai-agents/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.aiAgents(boardId) }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useDeleteAiAgent(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/ai-agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.aiAgents(boardId) }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

// ------------------------------------------------------------------------------- aprovações ---

export function useAiAgentRuns(agentId: string, enabled = true) {
  return useQuery({
    queryKey: qk.aiAgentRuns(agentId),
    queryFn: () =>
      api<{ data: AiAgentRun[] }>(`/v1/ai-agents/${agentId}/runs`).then((response) => response.data),
    enabled,
  });
}

export function useDecideAiAgentRun(agentId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ runId, decision, note }: { runId: string; decision: 'approve' | 'reject'; note?: string }) =>
      api<AiAgentRun>(`/v1/ai-agent-runs/${runId}/${decision}`, {
        method: 'POST',
        body: note === undefined ? {} : { note },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.aiAgentRuns(agentId) }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useRevertAiAgentRun(agentId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (runId: string) => api<AiAgentRun>(`/v1/ai-agent-runs/${runId}/revert`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.aiAgentRuns(agentId) }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}
