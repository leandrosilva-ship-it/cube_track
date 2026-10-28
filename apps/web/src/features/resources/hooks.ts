'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  Absence,
  AbsenceType,
  Allocation,
  AllocationStatus,
  CapacityGranularity,
  CapacityHeatmapResponse,
  ForecastBucket,
  LevelingSuggestion,
  ResourceProfile,
  ResourceRequest,
  Skill,
  Team,
  UserSkill,
  WhatIfResponse,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk, type CapacityScopeParams } from '@/lib/query/keys';

// -------------------------------------------------------------------------- perfis de recurso ---

export function useResourceProfiles() {
  return useQuery({
    queryKey: qk.resourceProfiles(),
    queryFn: async ({ signal }) =>
      (await api<{ data: ResourceProfile[] }>('/v1/resource-profiles', { signal })).data,
  });
}

export function useResourceProfile(userId: string) {
  return useQuery({
    queryKey: qk.resourceProfile(userId),
    queryFn: ({ signal }) => api<ResourceProfile>(`/v1/users/${userId}/resource-profile`, { signal }),
  });
}

export interface UpsertResourceProfileInput {
  jobTitle?: string | null;
  department?: string | null;
  managerId?: string | null;
  capacityHoursPerWeek?: string;
  costRateHour?: string | null;
  billRateHour?: string | null;
  workCalendarId?: string | null;
  location?: string | null;
}

export function useUpsertResourceProfile() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpsertResourceProfileInput }) =>
      api<ResourceProfile>(`/v1/users/${userId}/resource-profile`, { method: 'PUT', body: input }),
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.resourceProfile(profile.userId), profile);
      void queryClient.invalidateQueries({ queryKey: qk.resourceProfiles() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------------------------ skills ---

export function useSkills() {
  return useQuery({
    queryKey: qk.skills(),
    queryFn: async ({ signal }) => (await api<{ data: Skill[] }>('/v1/skills', { signal })).data,
  });
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { name: string; category?: string | null }) =>
      api<Skill>('/v1/skills', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.skills() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name?: string; category?: string | null } }) =>
      api<Skill>(`/v1/skills/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.skills() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.skills() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUserSkills(userId: string) {
  return useQuery({
    queryKey: qk.userSkills(userId),
    queryFn: async ({ signal }) =>
      (await api<{ data: UserSkill[] }>(`/v1/users/${userId}/skills`, { signal })).data,
  });
}

export function useSetUserSkills() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ userId, entries }: { userId: string; entries: { skillId: string; level: number }[] }) =>
      api<{ data: UserSkill[] }>(`/v1/users/${userId}/skills`, { method: 'PUT', body: { entries } }),
    onSuccess: (_result, { userId }) =>
      queryClient.invalidateQueries({ queryKey: qk.userSkills(userId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------------------------- teams ---

export function useTeams() {
  return useQuery({
    queryKey: qk.teams(),
    queryFn: async ({ signal }) => (await api<{ data: Team[] }>('/v1/teams', { signal })).data,
  });
}

// -------------------------------------------------------------------------------- alocações ---

export function useAllocationsOfBoard(boardId: string, from?: string, to?: string) {
  return useQuery({
    queryKey: qk.allocationsOfBoard(boardId, from, to),
    queryFn: async ({ signal }) =>
      (
        await api<{ data: Allocation[] }>(`/v1/boards/${boardId}/allocations`, {
          signal,
          query: { from, to },
        })
      ).data,
  });
}

export function useAllocationsOfUser(userId: string, from: string, to: string) {
  return useQuery({
    queryKey: qk.allocationsOfUser(userId, from, to),
    queryFn: async ({ signal }) =>
      (
        await api<{ data: Allocation[] }>(`/v1/users/${userId}/allocations`, {
          signal,
          query: { from, to },
        })
      ).data,
    enabled: from !== '' && to !== '',
  });
}

export interface AllocationInput {
  userId: string;
  boardId: string;
  itemId?: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: string;
  status?: AllocationStatus;
  notes?: string | null;
}

function invalidateCapacity(queryClient: ReturnType<typeof useQueryClient>, boardId?: string) {
  void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'capacity' });
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'users' && query.queryKey[2] === 'allocations',
  });
  if (boardId !== undefined)
    void queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'boards' && query.queryKey[1] === boardId && query.queryKey[2] === 'allocations',
    });
}

export function useCreateAllocation() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: AllocationInput) => api<Allocation>('/v1/allocations', { method: 'POST', body: input }),
    onSuccess: (allocation) => { invalidateCapacity(queryClient, allocation.boardId); },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export interface UpdateAllocationInput {
  startDate?: string;
  endDate?: string;
  hoursPerDay?: string;
  status?: AllocationStatus;
  notes?: string | null;
}

export function useUpdateAllocation() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAllocationInput }) =>
      api<Allocation>(`/v1/allocations/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (allocation) => { invalidateCapacity(queryClient, allocation.boardId); },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteAllocation() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id }: { id: string; boardId: string }) =>
      api<undefined>(`/v1/allocations/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, { boardId }) => { invalidateCapacity(queryClient, boardId); },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// --------------------------------------------------------------------------------- ausências ---

export function useAbsencesOfUser(userId: string) {
  return useQuery({
    queryKey: qk.absencesOfUser(userId),
    queryFn: async ({ signal }) =>
      (await api<{ data: Absence[] }>(`/v1/users/${userId}/absences`, { signal })).data,
  });
}

/** Fila de aprovação (`resources.manage`/`timesheet.approve`): todas as ausências `submitted` do tenant. */
export function usePendingAbsences() {
  return useQuery({
    queryKey: qk.pendingAbsences(),
    queryFn: async ({ signal }) => (await api<{ data: Absence[] }>('/v1/absences/pending', { signal })).data,
  });
}

export interface RequestAbsenceInput {
  startDate: string;
  endDate: string;
  type: AbsenceType;
  hoursPerDay?: string | null;
  notes?: string | null;
}

export function useRequestAbsence(userId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: RequestAbsenceInput) => api<Absence>('/v1/absences', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.absencesOfUser(userId) });
      void queryClient.invalidateQueries({ queryKey: qk.pendingAbsences() });
      invalidateCapacity(queryClient);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDecideAbsence() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected'; userId: string }) =>
      api<Absence>(`/v1/absences/${id}/decide`, { method: 'POST', body: { status } }),
    onSuccess: (_result, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.absencesOfUser(userId) });
      void queryClient.invalidateQueries({ queryKey: qk.pendingAbsences() });
      invalidateCapacity(queryClient);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteAbsence() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id }: { id: string; userId: string }) =>
      api<undefined>(`/v1/absences/${id}`, { method: 'DELETE' }),
    onSuccess: (_result, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.absencesOfUser(userId) });
      void queryClient.invalidateQueries({ queryKey: qk.pendingAbsences() });
      invalidateCapacity(queryClient);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// --------------------------------------------------------------------------- solicitações ---

export function useResourceRequestsOfBoard(boardId: string) {
  return useQuery({
    queryKey: qk.resourceRequestsOfBoard(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: ResourceRequest[] }>(`/v1/boards/${boardId}/resource-requests`, { signal })).data,
  });
}

export function useOpenResourceRequests() {
  return useQuery({
    queryKey: qk.openResourceRequests(),
    queryFn: async ({ signal }) =>
      (await api<{ data: ResourceRequest[] }>('/v1/resource-requests', { signal, query: { status: 'open' } }))
        .data,
  });
}

export interface ResourceRequestInput {
  itemId?: string | null;
  skillId?: string | null;
  roleTitle: string;
  hours: string;
  startDate: string;
  endDate: string;
  notes?: string | null;
}

function invalidateResourceRequests(queryClient: ReturnType<typeof useQueryClient>, boardId: string) {
  void queryClient.invalidateQueries({ queryKey: qk.resourceRequestsOfBoard(boardId) });
  void queryClient.invalidateQueries({ queryKey: qk.openResourceRequests() });
}

export function useCreateResourceRequest(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: ResourceRequestInput) =>
      api<ResourceRequest>(`/v1/boards/${boardId}/resource-requests`, { method: 'POST', body: input }),
    onSuccess: () => { invalidateResourceRequests(queryClient, boardId); },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useAssignResourceRequest(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, assignedUserId }: { id: string; assignedUserId: string }) =>
      api<ResourceRequest>(`/v1/resource-requests/${id}/assign`, { method: 'POST', body: { assignedUserId } }),
    onSuccess: () => {
      invalidateResourceRequests(queryClient, boardId);
      invalidateCapacity(queryClient, boardId);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useCancelResourceRequest(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<ResourceRequest>(`/v1/resource-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { invalidateResourceRequests(queryClient, boardId); },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

function invalidateAllResourceRequests(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes('resource-requests') });
}

/** Mesma operação, sem um board conhecido de antemão (ex.: a fila "Solicitações" da página standalone). */
export function useAssignOpenResourceRequest() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, assignedUserId }: { id: string; assignedUserId: string }) =>
      api<ResourceRequest>(`/v1/resource-requests/${id}/assign`, { method: 'POST', body: { assignedUserId } }),
    onSuccess: () => {
      invalidateAllResourceRequests(queryClient);
      invalidateCapacity(queryClient);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useCancelOpenResourceRequest() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<ResourceRequest>(`/v1/resource-requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => { invalidateAllResourceRequests(queryClient); },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// --------------------------------------------------------------------------------- capacidade ---

function scopeQuery(params: CapacityScopeParams) {
  return {
    from: params.from,
    to: params.to,
    granularity: params.granularity,
    userIds: params.userIds,
    teamIds: params.teamIds,
    skillId: params.skillId,
    boardId: params.boardId,
  };
}

export function useCapacityHeatmap(params: CapacityScopeParams) {
  return useQuery({
    queryKey: qk.capacityHeatmap(params),
    queryFn: ({ signal }) =>
      api<CapacityHeatmapResponse>('/v1/capacity/heatmap', { signal, query: scopeQuery(params) }),
  });
}

export function useCapacityLeveling(params: CapacityScopeParams) {
  return useQuery({
    queryKey: qk.capacityLeveling(params),
    queryFn: async ({ signal }) =>
      (
        await api<{ data: LevelingSuggestion[] }>('/v1/capacity/leveling-suggestions', {
          signal,
          query: scopeQuery(params),
        })
      ).data,
  });
}

export function useCapacityForecast(months: 3 | 6 | 12) {
  return useQuery({
    queryKey: qk.capacityForecast(months),
    queryFn: async ({ signal }) =>
      (await api<{ data: ForecastBucket[] }>('/v1/capacity/forecast', { signal, query: { months } })).data,
  });
}

export interface WhatIfInput {
  from: string;
  to: string;
  userId: string;
  granularity?: CapacityGranularity;
  hypotheticalAllocations: { startDate: string; endDate: string; hoursPerDay: string }[];
}

/** Simulação what-if: nunca persiste nada, só compara real × hipotético (ADR 0052). */
export function useWhatIf() {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: WhatIfInput) => api<WhatIfResponse>('/v1/capacity/what-if', { method: 'POST', body: input }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
