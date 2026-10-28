'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/lib/api/client';
import type {
  CreateTimeEntryInput,
  Item,
  TimeEntry,
  TimesheetApproval,
  UpdateTimeEntryInput,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

// ---------------------------------------------------------------------------- time entries ---

export function useTimeEntriesOfUser(userId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: qk.timeEntriesOfUser(userId ?? '', from, to),
    queryFn: async ({ signal }) =>
      (
        await api<{ data: TimeEntry[] }>(`/v1/users/${userId ?? ''}/time-entries`, {
          query: { from, to },
          signal,
        })
      ).data,
    enabled: userId !== null,
  });
}

export function useTimeEntriesOfItem(itemId: string | null) {
  return useQuery({
    queryKey: qk.timeEntriesOfItem(itemId ?? ''),
    queryFn: async ({ signal }) =>
      (await api<{ data: TimeEntry[] }>(`/v1/items/${itemId ?? ''}/time-entries`, { signal })).data,
    enabled: itemId !== null,
  });
}

function invalidateTimeEntries(queryClient: ReturnType<typeof useQueryClient>, entry: TimeEntry) {
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'users' && query.queryKey[2] === 'time-entries',
  });
  void queryClient.invalidateQueries({ queryKey: qk.timeEntriesOfItem(entry.itemId) });
  void queryClient.invalidateQueries({ queryKey: qk.timesheetApprovalsOfUser(entry.userId) });
}

export function useCreateTimeEntry() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: CreateTimeEntryInput) =>
      api<TimeEntry>('/v1/time-entries', { method: 'POST', body: input }),
    onSuccess: (entry) => {
      invalidateTimeEntries(queryClient, entry);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateTimeEntry() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTimeEntryInput }) =>
      api<TimeEntry>(`/v1/time-entries/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (entry) => {
      invalidateTimeEntries(queryClient, entry);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id }: { id: string; entry: TimeEntry }) =>
      api<undefined>(`/v1/time-entries/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) => {
      invalidateTimeEntries(queryClient, variables.entry);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function timeEntriesExportUrl(userId: string, from: string, to: string): string {
  const params = new URLSearchParams({ from, to });
  return `/v1/users/${userId}/time-entries/export.csv?${params.toString()}`;
}

// -------------------------------------------------------------------------------- approvals ---

export function useTimesheetApprovalsOfUser(userId: string | null) {
  return useQuery({
    queryKey: qk.timesheetApprovalsOfUser(userId ?? ''),
    queryFn: async ({ signal }) =>
      (
        await api<{ data: TimesheetApproval[] }>(`/v1/users/${userId ?? ''}/timesheet-approvals`, {
          signal,
        })
      ).data,
    enabled: userId !== null,
  });
}

export function usePendingTimesheetApprovals() {
  return useQuery({
    queryKey: qk.timesheetApprovalsPending(),
    queryFn: async ({ signal }) =>
      (await api<{ data: TimesheetApproval[] }>('/v1/timesheet-approvals/pending', { signal })).data,
    retry: false,
  });
}

export function useSubmitTimesheetWeek() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (periodStart: string) =>
      api<TimesheetApproval>('/v1/timesheet-approvals/submit', {
        method: 'POST',
        body: { periodStart },
      }),
    onSuccess: (approval) => {
      void queryClient.invalidateQueries({ queryKey: qk.timesheetApprovalsOfUser(approval.userId) });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'users' && query.queryKey[2] === 'time-entries',
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDecideTimesheetApproval() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({
      id,
      status,
      comment,
    }: {
      id: string;
      status: 'approved' | 'rejected';
      comment?: string | null;
    }) =>
      api<TimesheetApproval>(`/v1/timesheet-approvals/${id}/decide`, {
        method: 'POST',
        body: { status, comment },
      }),
    onSuccess: (approval) => {
      void queryClient.invalidateQueries({ queryKey: qk.timesheetApprovalsPending() });
      void queryClient.invalidateQueries({ queryKey: qk.timesheetApprovalsOfUser(approval.userId) });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'users' && query.queryKey[2] === 'time-entries',
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

/** Nomes de itens para exibir nas linhas da grade semanal (busca individual, cacheada por item). */
export function useItemNames(itemIds: readonly string[]): Map<string, string> {
  const unique = useMemo(() => [...new Set(itemIds)], [itemIds]);
  const results = useQueries({
    queries: unique.map((itemId) => ({
      queryKey: qk.item(itemId),
      queryFn: () => api<Item>(`/v1/items/${itemId}`),
      staleTime: 60_000,
    })),
  });
  return useMemo(() => {
    const map = new Map<string, string>();
    unique.forEach((itemId, index) => {
      const name = results[index]?.data?.name;
      if (name !== undefined) map.set(itemId, name);
    });
    return map;
  }, [unique, results]);
}
