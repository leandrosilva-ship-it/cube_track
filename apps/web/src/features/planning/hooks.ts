'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  Baseline,
  BaselineDetail,
  GanttData,
  Item,
  Milestone,
  SchedulePreview,
  ScheduleImportResult,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import { patchItem } from '@/realtime/apply';

/**
 * Reagenda um item (Calendário/Timeline, arrastar-e-soltar): grava datas nativas ou uma coluna
 * `date` via `PATCH /v1/items/:id`, com atualização otimista da lista de itens em cache — o mesmo
 * caminho de cache que a Tabela/Kanban usam para os eventos de tempo real (`patchItem`).
 */
export function useRescheduleItem(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string;
      body: { fields?: Record<string, string | null>; values?: Record<string, unknown> };
    }) => api(`/v1/items/${itemId}`, { method: 'PATCH', body }),
    onMutate: ({ itemId, body }) => {
      patchItem(queryClient, boardId, itemId, (item): Item => ({
        ...item,
        ...(body.fields as Partial<Item> | undefined),
        values: body.values === undefined ? item.values : { ...item.values, ...body.values },
      }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ----------------------------------------------------------------------------------- Gantt ---

export function useGanttData(boardId: string) {
  return useQuery({
    queryKey: qk.gantt(boardId),
    queryFn: ({ signal }) => api<GanttData>(`/v1/boards/${boardId}/gantt`, { signal }),
  });
}

export interface GanttItemPatch {
  fields?: { plannedStartDate?: string | null; plannedEndDate?: string | null };
  isMilestone?: boolean;
  scheduleMode?: 'auto' | 'manual';
}

/**
 * Edição direta de datas/marco/modo pelo Gantt (arrastar barra, alternar marco/manual): grava
 * direto via `PATCH /v1/items/:id` com atualização otimista da própria tela — sem o fluxo de
 * campos obrigatórios/desfazer da Tabela (arrastar uma barra não torna outro campo obrigatório).
 * Permissões por coluna continuam valendo no servidor normalmente.
 */
export function usePatchGanttItem(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ itemId, patch }: { itemId: string; patch: GanttItemPatch }) =>
      api(`/v1/items/${itemId}`, { method: 'PATCH', body: patch }),
    onMutate: ({ itemId, patch }) => {
      const previous = queryClient.getQueryData<GanttData>(qk.gantt(boardId));
      queryClient.setQueryData<GanttData>(qk.gantt(boardId), (data) =>
        data === undefined
          ? data
          : {
              ...data,
              tasks: data.tasks.map((task) =>
                task.id === itemId
                  ? {
                      ...task,
                      ...(patch.fields?.plannedStartDate !== undefined
                        ? { plannedStartDate: patch.fields.plannedStartDate, start: patch.fields.plannedStartDate }
                        : {}),
                      ...(patch.fields?.plannedEndDate !== undefined
                        ? { plannedEndDate: patch.fields.plannedEndDate, end: patch.fields.plannedEndDate }
                        : {}),
                      ...(patch.isMilestone === undefined ? {} : { isMilestone: patch.isMilestone }),
                      ...(patch.scheduleMode === undefined ? {} : { scheduleMode: patch.scheduleMode }),
                    }
                  : task,
              ),
            },
      );
      return { previous };
    },
    onError: (error, _input, ctx) => {
      if (ctx?.previous !== undefined) queryClient.setQueryData(qk.gantt(boardId), ctx.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) }),
  });
}

// ------------------------------------------------------------------------------- marcos ---

export function useMilestones(boardId: string) {
  return useQuery({
    queryKey: qk.milestones(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Milestone[] }>(`/v1/boards/${boardId}/milestones`, { signal })).data,
  });
}

export interface MilestoneInput {
  name: string;
  description?: string | null;
  dueDate: string;
  itemId?: string | null;
  status?: Milestone['status'];
}

export function useCreateMilestone(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: MilestoneInput) =>
      api<Milestone>(`/v1/boards/${boardId}/milestones`, { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.milestones(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateMilestone(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<MilestoneInput> }) =>
      api<Milestone>(`/v1/milestones/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.milestones(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteMilestone(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/milestones/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.milestones(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ----------------------------------------------------------------------------- baselines ---

export function useBaselines(boardId: string) {
  return useQuery({
    queryKey: qk.baselines(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Baseline[] }>(`/v1/boards/${boardId}/baselines`, { signal })).data,
  });
}

export function useBaselineDetail(baselineId: string | null) {
  return useQuery({
    queryKey: qk.baseline(baselineId ?? 'none'),
    enabled: baselineId !== null,
    queryFn: ({ signal }) => api<BaselineDetail>(`/v1/baselines/${baselineId}`, { signal }),
  });
}

export function useCaptureBaseline(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { name: string; description?: string | null }) =>
      api<Baseline>(`/v1/boards/${boardId}/baselines`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.baselines(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useSetPrimaryBaseline(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (baselineId: string) =>
      api<Baseline>(`/v1/baselines/${baselineId}/primary`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.baselines(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteBaseline(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (baselineId: string) =>
      api<undefined>(`/v1/baselines/${baselineId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.baselines(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// --------------------------------------------------------------------- importação MS Project ---

export function usePreviewScheduleImport(boardId: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { fileName: string; contentBase64: string }) =>
      api<SchedulePreview>(`/v1/boards/${boardId}/schedule-imports`, {
        method: 'POST',
        body: input,
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useCommitScheduleImport(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ importId, groupId }: { importId: string; groupId: string }) =>
      api<ScheduleImportResult>(`/v1/boards/${boardId}/schedule-imports/${importId}/commit`, {
        method: 'POST',
        body: { groupId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.items(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
