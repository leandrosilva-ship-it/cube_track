'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  CreatePortfolioInput,
  CreateProgramInput,
  CreateScoringModelInput,
  Portfolio,
  PortfolioWhatIfChange,
  PortfolioWhatIfResponse,
  Program,
  RankingEntry,
  RollupResult,
  Score,
  ScoringModel,
  SetScoreInput,
  UpdatePortfolioInput,
  UpdateProgramInput,
  UpdateScoringModelInput,
  ValueEffortPoint,
} from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

// -------------------------------------------------------------------------------- portfólios ---

export function usePortfolios(workspaceId: string) {
  return useQuery({
    queryKey: qk.portfoliosOf(workspaceId),
    queryFn: ({ signal }) =>
      api<{ data: Portfolio[] }>(`/v1/workspaces/${workspaceId}/portfolios`, { signal }).then((r) => r.data),
  });
}

export function useCreatePortfolio(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePortfolioInput) =>
      api<Portfolio>(`/v1/workspaces/${workspaceId}/portfolios`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.portfoliosOf(workspaceId) }),
  });
}

export function useUpdatePortfolio(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePortfolioInput }) =>
      api<Portfolio>(`/v1/portfolios/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (portfolio) => {
      void queryClient.invalidateQueries({ queryKey: qk.portfoliosOf(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.portfolioRollup(portfolio.id) });
    },
  });
}

export function useDeletePortfolio(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/portfolios/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.portfoliosOf(workspaceId) }),
  });
}

export function usePortfolioRollup(id: string | undefined) {
  return useQuery({
    queryKey: qk.portfolioRollup(id ?? 'none'),
    queryFn: ({ signal }) => api<RollupResult>(`/v1/portfolios/${id}/rollup`, { signal }),
    enabled: id !== undefined,
  });
}

// ---------------------------------------------------------------------------------- programas ---

export function usePrograms(workspaceId: string) {
  return useQuery({
    queryKey: qk.programsOf(workspaceId),
    queryFn: ({ signal }) =>
      api<{ data: Program[] }>(`/v1/workspaces/${workspaceId}/programs`, { signal }).then((r) => r.data),
  });
}

export function useCreateProgram(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProgramInput) =>
      api<Program>(`/v1/workspaces/${workspaceId}/programs`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.programsOf(workspaceId) }),
  });
}

export function useUpdateProgram(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProgramInput }) =>
      api<Program>(`/v1/programs/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (program) => {
      void queryClient.invalidateQueries({ queryKey: qk.programsOf(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.programRollup(program.id) });
    },
  });
}

export function useDeleteProgram(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/programs/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.programsOf(workspaceId) }),
  });
}

export function useProgramRollup(id: string | undefined) {
  return useQuery({
    queryKey: qk.programRollup(id ?? 'none'),
    queryFn: ({ signal }) => api<RollupResult>(`/v1/programs/${id}/rollup`, { signal }),
    enabled: id !== undefined,
  });
}

// ----------------------------------------------------------------------------- status report ---

export function usePortfolioStatusReport(id: string | undefined) {
  return useQuery({
    queryKey: qk.portfolioStatusReport(id ?? 'none'),
    queryFn: ({ signal }) => api<RollupResult>(`/v1/portfolios/${id}/status-report`, { signal }),
    enabled: id !== undefined,
  });
}

export function useProgramStatusReport(id: string | undefined) {
  return useQuery({
    queryKey: qk.programStatusReport(id ?? 'none'),
    queryFn: ({ signal }) => api<RollupResult>(`/v1/programs/${id}/status-report`, { signal }),
    enabled: id !== undefined,
  });
}

// ------------------------------------------------------------------------------- priorização ---

export function useScoringModels() {
  return useQuery({
    queryKey: qk.scoringModels(),
    queryFn: ({ signal }) => api<{ data: ScoringModel[] }>('/v1/scoring-models', { signal }).then((r) => r.data),
  });
}

export function useCreateScoringModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScoringModelInput) =>
      api<ScoringModel>('/v1/scoring-models', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.scoringModels() }),
  });
}

export function useUpdateScoringModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScoringModelInput }) =>
      api<ScoringModel>(`/v1/scoring-models/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.scoringModels() }),
  });
}

export function useSetScore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, input }: { boardId: string; input: SetScoreInput }) =>
      api<Score>(`/v1/boards/${boardId}/score`, { method: 'POST', body: input }),
    onSuccess: (score) => {
      void queryClient.invalidateQueries({ queryKey: qk.scoringRanking(score.scoringModelId) });
      void queryClient.invalidateQueries({ queryKey: qk.scoringValueEffort(score.scoringModelId) });
    },
  });
}

export function useScoringRanking(modelId: string | undefined) {
  return useQuery({
    queryKey: qk.scoringRanking(modelId ?? 'none'),
    queryFn: ({ signal }) =>
      api<{ data: RankingEntry[] }>(`/v1/scoring-models/${modelId}/ranking`, { signal }).then((r) => r.data),
    enabled: modelId !== undefined,
  });
}

export function useValueEffortMatrix(modelId: string | undefined) {
  return useQuery({
    queryKey: qk.scoringValueEffort(modelId ?? 'none'),
    queryFn: ({ signal }) =>
      api<{ data: ValueEffortPoint[] }>(`/v1/scoring-models/${modelId}/value-effort`, { signal }).then(
        (r) => r.data,
      ),
    enabled: modelId !== undefined,
  });
}

// --------------------------------------------------------------------------------- what-if ---

export function useWhatIfSimulation() {
  return useMutation({
    mutationFn: (input: { scope: 'portfolio' | 'program'; id: string; changes: PortfolioWhatIfChange[] }) =>
      api<PortfolioWhatIfResponse>('/v1/portfolio/what-if', { method: 'POST', body: input }),
  });
}
