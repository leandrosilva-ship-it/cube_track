'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  Dashboard,
  DashboardWidgetData,
  ProjectHealthEntry,
  Widget,
  WidgetLayout,
  WidgetType,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

// ------------------------------------------------------------------------------- dashboards ---

export function useDashboards(workspaceId: string) {
  return useQuery({
    queryKey: qk.dashboardsOf(workspaceId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Dashboard[] }>(`/v1/workspaces/${workspaceId}/dashboards`, { signal })).data,
  });
}

export function useDashboard(dashboardId: string) {
  return useQuery({
    queryKey: qk.dashboard(dashboardId),
    queryFn: ({ signal }) => api<Dashboard>(`/v1/dashboards/${dashboardId}`, { signal }),
  });
}

export interface CreateDashboardInput {
  name: string;
  description?: string | null;
  visibility?: Dashboard['visibility'];
  sourceBoardIds?: string[];
}

export function useCreateDashboard(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: CreateDashboardInput) =>
      api<Dashboard>(`/v1/workspaces/${workspaceId}/dashboards`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.dashboardsOf(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export interface UpdateDashboardInput {
  name?: string;
  description?: string | null;
  visibility?: Dashboard['visibility'];
  sourceBoardIds?: string[];
  refreshIntervalSeconds?: number | null;
}

export function useUpdateDashboard(dashboardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: UpdateDashboardInput) =>
      api<Dashboard>(`/v1/dashboards/${dashboardId}`, { method: 'PATCH', body: input }),
    onSuccess: (dashboard) => {
      queryClient.setQueryData(qk.dashboard(dashboardId), dashboard);
      void queryClient.invalidateQueries({ queryKey: qk.dashboardsOf(dashboard.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteDashboard(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (dashboardId: string) => api<undefined>(`/v1/dashboards/${dashboardId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.dashboardsOf(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------------------------ widgets ---

export function useDashboardWidgets(dashboardId: string) {
  return useQuery({
    queryKey: qk.dashboardWidgets(dashboardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Widget[] }>(`/v1/dashboards/${dashboardId}/widgets`, { signal })).data,
  });
}

export interface WidgetInput {
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  layout: WidgetLayout;
}

export function useCreateWidget(dashboardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: WidgetInput) =>
      api<Widget>(`/v1/dashboards/${dashboardId}/widgets`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboardWidgets(dashboardId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateWidget(dashboardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<WidgetInput> }) =>
      api<Widget>(`/v1/widgets/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboardWidgets(dashboardId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteWidget(dashboardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/widgets/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.dashboardWidgets(dashboardId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Dados computados de todos os widgets do dashboard (agregação no servidor, ADR 0050). */
export function useDashboardData(dashboardId: string, refreshIntervalSeconds?: number | null) {
  return useQuery({
    queryKey: qk.dashboardData(dashboardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: DashboardWidgetData[] }>(`/v1/dashboards/${dashboardId}/data`, { signal })).data,
    refetchInterval:
      refreshIntervalSeconds === undefined || refreshIntervalSeconds === null
        ? false
        : refreshIntervalSeconds * 1_000,
  });
}

export function widgetExportUrl(widgetId: string): string {
  return `/v1/widgets/${widgetId}/export.csv`;
}

// ---------------------------------------------------------------------- saúde do projeto ---

export function useProjectHealthHistory(boardId: string) {
  return useQuery({
    queryKey: qk.projectHealth(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: ProjectHealthEntry[] }>(`/v1/boards/${boardId}/project-health`, { signal })).data,
  });
}

export interface ReportProjectHealthInput {
  overall: ProjectHealthEntry['overall'];
  schedule?: ProjectHealthEntry['schedule'];
  cost?: ProjectHealthEntry['cost'];
  scope?: ProjectHealthEntry['scope'];
  quality?: ProjectHealthEntry['quality'];
  risk?: ProjectHealthEntry['risk'];
  percentComplete?: number;
  spi?: number;
  cpi?: number;
  summary?: string;
  overrideReason?: string;
}

export function useReportProjectHealth(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: ReportProjectHealthInput) =>
      api<ProjectHealthEntry>(`/v1/boards/${boardId}/project-health`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projectHealth(boardId) });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes('data') && query.queryKey.includes('dashboards'),
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
