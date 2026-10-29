'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  BoardStatusReport,
  CostEntry,
  CostEntryKind,
  GovernanceIssue,
  HealthRule,
  HealthRuleSet,
  IssueSeverity,
  IssueStatus,
  PortfolioBudget,
  Risk,
  RiskStatus,
  RiskStrategy,
  StageGate,
} from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

// ----------------------------------------------------------------------------- stage gates ---

export function useStageGates(boardId: string) {
  return useQuery({
    queryKey: qk.stageGatesOfBoard(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: StageGate[] }>(`/v1/boards/${boardId}/stage-gates`, { signal })).data,
  });
}

export interface CreateStageGateInput {
  name: string;
  dueDate?: string | null;
  criteria?: { label: string; met: boolean }[];
}

export function useCreateStageGate(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStageGateInput) =>
      api<StageGate>(`/v1/boards/${boardId}/stage-gates`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.stageGatesOfBoard(boardId) });
    },
  });
}

export interface UpdateStageGateInput {
  name?: string;
  dueDate?: string | null;
  criteria?: { label: string; met: boolean }[];
  notes?: string | null;
}

export function useUpdateStageGate(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateStageGateInput }) =>
      api<StageGate>(`/v1/stage-gates/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.stageGatesOfBoard(boardId) });
    },
  });
}

export function useDecideStageGate(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      notes,
    }: {
      id: string;
      status: 'approved' | 'rejected' | 'skipped';
      notes?: string | null;
    }) => api<StageGate>(`/v1/stage-gates/${id}/decide`, { method: 'POST', body: { status, notes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.stageGatesOfBoard(boardId) });
    },
  });
}

export function useReorderStageGates(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      api(`/v1/boards/${boardId}/stage-gates/reorder`, { method: 'POST', body: { orderedIds } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.stageGatesOfBoard(boardId) });
    },
  });
}

export function useDeleteStageGate(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/stage-gates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.stageGatesOfBoard(boardId) });
    },
  });
}

// ----------------------------------------------------------------------------------- riscos ---

export function useRisks(boardId: string) {
  return useQuery({
    queryKey: qk.risksOfBoard(boardId),
    queryFn: async ({ signal }) => (await api<{ data: Risk[] }>(`/v1/boards/${boardId}/risks`, { signal })).data,
  });
}

export interface RiskInput {
  title: string;
  description?: string | null;
  category?: string | null;
  itemId?: string | null;
  probability: number;
  impact: number;
  status?: RiskStatus;
  strategy?: RiskStrategy | null;
  mitigationPlan?: string | null;
  contingencyPlan?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
}

export function useCreateRisk(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RiskInput) => api<Risk>(`/v1/boards/${boardId}/risks`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.risksOfBoard(boardId) });
    },
  });
}

export function useUpdateRisk(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<RiskInput> }) =>
      api<Risk>(`/v1/risks/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.risksOfBoard(boardId) });
    },
  });
}

export function useDeleteRisk(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/risks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.risksOfBoard(boardId) });
    },
  });
}

// --------------------------------------------------------------------------------- problemas ---

export function useIssues(boardId: string) {
  return useQuery({
    queryKey: qk.issuesOfBoard(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: GovernanceIssue[] }>(`/v1/boards/${boardId}/issues`, { signal })).data,
  });
}

export interface IssueInput {
  title: string;
  description?: string | null;
  itemId?: string | null;
  riskId?: string | null;
  severity?: IssueSeverity;
  status?: IssueStatus;
  ownerId?: string | null;
  dueDate?: string | null;
  resolution?: string | null;
}

export function useCreateIssue(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IssueInput) =>
      api<GovernanceIssue>(`/v1/boards/${boardId}/issues`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.issuesOfBoard(boardId) });
    },
  });
}

export function useUpdateIssue(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<IssueInput> }) =>
      api<GovernanceIssue>(`/v1/issues/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.issuesOfBoard(boardId) });
    },
  });
}

export function useDeleteIssue(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/issues/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.issuesOfBoard(boardId) });
    },
  });
}

// -------------------------------------------------------------------------------- orçamentos ---

export function useBudgetsOfBoard(boardId: string) {
  return useQuery({
    queryKey: qk.budgetsOfBoard(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: PortfolioBudget[] }>(`/v1/boards/${boardId}/budgets`, { signal })).data,
  });
}

export interface BudgetInput {
  name: string;
  category?: 'capex' | 'opex';
  currency?: string;
  plannedAmount: string;
  fiscalYear?: number | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export function useCreateBudget(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BudgetInput) =>
      api<PortfolioBudget>(`/v1/boards/${boardId}/budgets`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.budgetsOfBoard(boardId) });
    },
  });
}

export function useUpdateBudget(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<BudgetInput> }) =>
      api<PortfolioBudget>(`/v1/budgets/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.budgetsOfBoard(boardId) });
    },
  });
}

export function useDeleteBudget(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/budgets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.budgetsOfBoard(boardId) });
    },
  });
}

export function useCostEntries(budgetId: string | null) {
  return useQuery({
    queryKey: qk.costEntriesOfBudget(budgetId ?? 'none'),
    queryFn: async ({ signal }) =>
      (await api<{ data: CostEntry[] }>(`/v1/budgets/${budgetId}/cost-entries`, { signal })).data,
    enabled: budgetId !== null,
  });
}

export interface CostEntryInput {
  entryDate: string;
  amount: string;
  currency?: string;
  kind?: CostEntryKind;
  itemId?: string | null;
  category?: string | null;
  description?: string | null;
  reference?: string | null;
}

export function useCreateCostEntry(budgetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CostEntryInput) =>
      api<CostEntry>(`/v1/budgets/${budgetId}/cost-entries`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.costEntriesOfBudget(budgetId) });
    },
  });
}

export function useUpdateCostEntry(budgetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CostEntryInput> }) =>
      api<CostEntry>(`/v1/cost-entries/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.costEntriesOfBudget(budgetId) });
    },
  });
}

export function useDeleteCostEntry(budgetId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/v1/cost-entries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.costEntriesOfBudget(budgetId) });
    },
  });
}

// -------------------------------------------------------------------------------- saúde/RAG ---

export function useBoardHealthRules(boardId: string) {
  return useQuery({
    queryKey: qk.healthRulesOfBoard(boardId),
    queryFn: async ({ signal }) => api<HealthRuleSet>(`/v1/boards/${boardId}/health-rules`, { signal }),
  });
}

export function useDefaultHealthRules() {
  return useQuery({
    queryKey: qk.healthRulesDefault(),
    queryFn: async ({ signal }) => api<HealthRuleSet>('/v1/health-rules/default', { signal }),
  });
}

export function useSetBoardHealthRules(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: HealthRule[]) =>
      api<HealthRuleSet>(`/v1/boards/${boardId}/health-rules`, { method: 'PUT', body: { rules } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.healthRulesOfBoard(boardId) });
    },
  });
}

// ---------------------------------------------------------------------------- status report ---

export function useBoardStatusReport(boardId: string) {
  return useQuery({
    queryKey: qk.boardStatusReport(boardId),
    queryFn: async ({ signal }) => api<BoardStatusReport>(`/v1/boards/${boardId}/status-report`, { signal }),
  });
}
