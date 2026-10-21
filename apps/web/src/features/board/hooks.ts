'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { FilterGroup, ViewGroupBy, ViewSortTerm } from '@cube-track/shared';

import { api } from '@/lib/api/client';
import type {
  BoardDetail,
  BoardView,
  SavedFilter,
  ShareLinkResult,
  ShareLinkStatus,
  ViewList,
  ViewType,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import { useSession } from '@/stores/session';

export function useBoard(boardId: string) {
  const enabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.boardDetail(boardId),
    queryFn: () => api<BoardDetail>(`/v1/boards/${boardId}`),
    enabled,
  });
}

export function useViews(boardId: string) {
  const enabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.views(boardId),
    queryFn: () => api<ViewList>(`/v1/boards/${boardId}/views`),
    enabled,
  });
}

export function useUpdateBoardDetails(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: {
      name?: string;
      description?: string | null;
      icon?: string | null;
      isTemplate?: boolean;
    }) => api<unknown>(`/v1/boards/${boardId}`, { method: 'PATCH', body: input }),
    onMutate: (input) => {
      const previous = queryClient.getQueryData<BoardDetail>(qk.boardDetail(boardId));
      queryClient.setQueryData<BoardDetail>(qk.boardDetail(boardId), (board) =>
        board === undefined ? board : { ...board, ...input },
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(qk.boardDetail(boardId), context?.previous);
      toast.error(errorMessage(error));
    },
  });
}

export function useCreateView(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { name: string; type: ViewType; personal: boolean }) =>
      api<ViewList['data'][number]>(`/v1/boards/${boardId}/views`, { method: 'POST', body: input }),
    onSuccess: (view) => {
      queryClient.setQueryData<ViewList>(qk.views(boardId), (list) =>
        list === undefined || list.data.some((entry) => entry.id === view.id)
          ? list
          : { ...list, data: [...list.data, view] },
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteView(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (viewId: string) => api<undefined>(`/v1/views/${viewId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.views(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export interface UpdateViewInput {
  name?: string;
  config?: Record<string, unknown>;
  filters?: FilterGroup | null;
  sort?: ViewSortTerm[];
  groupBy?: ViewGroupBy | null;
  hiddenColumnKeys?: string[];
  isDefault?: boolean;
  isLocked?: boolean;
  isRestricted?: boolean;
  afterId?: string | null;
  beforeId?: string | null;
}

/** Atualiza uma view (cache otimista: nome, config, filtros, ordenação, agrupamento, governança). */
export function useUpdateView(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ viewId, input }: { viewId: string; input: UpdateViewInput }) =>
      api<{ id: string; changes: Record<string, unknown> }>(`/v1/views/${viewId}`, {
        method: 'PATCH',
        body: input,
      }),
    onMutate: ({ viewId, input }) => {
      const previous = queryClient.getQueryData<ViewList>(qk.views(boardId));
      queryClient.setQueryData<ViewList>(qk.views(boardId), (list) =>
        list === undefined
          ? list
          : {
              ...list,
              data: list.data.map((view) =>
                view.id === viewId
                  ? {
                      ...view,
                      ...input,
                      filters: input.filters === undefined ? view.filters : input.filters,
                      groupBy: input.groupBy === undefined ? view.groupBy : input.groupBy,
                    }
                  : view,
              ),
            },
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(qk.views(boardId), context?.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.views(boardId) }),
  });
}

export interface DuplicateViewInput {
  name?: string;
  personal?: boolean;
}

export function useDuplicateView(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ viewId, input }: { viewId: string; input: DuplicateViewInput }) =>
      api<BoardView>(`/v1/views/${viewId}/duplicate`, { method: 'POST', body: input }),
    onSuccess: (view) => {
      queryClient.setQueryData<ViewList>(qk.views(boardId), (list) =>
        list === undefined ? list : { ...list, data: [...list.data, view] },
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------- link público da view ---

export function useShareLinkStatus(viewId: string, enabled: boolean) {
  const sessionEnabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.shareLink(viewId),
    queryFn: () => api<ShareLinkStatus>(`/v1/views/${viewId}/share-link`),
    enabled: enabled && sessionEnabled,
  });
}

export interface UpsertShareLinkInput {
  password?: string | null;
  expiresAt?: string | null;
  hiddenColumnKeys?: string[];
  allowSearch?: boolean;
  regenerateToken?: boolean;
}

export function useUpsertShareLink(viewId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: UpsertShareLinkInput) =>
      api<ShareLinkResult>(`/v1/views/${viewId}/share-link`, { method: 'PUT', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.shareLink(viewId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useRevokeShareLink(viewId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: () => api<undefined>(`/v1/views/${viewId}/share-link`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.shareLink(viewId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ----------------------------------------------------------------------------- filtros salvos ---

export function useSavedFilters(boardId: string) {
  const enabled = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.savedFilters(boardId),
    queryFn: () => api<{ data: SavedFilter[] }>(`/v1/boards/${boardId}/saved-filters`),
    enabled,
    select: (response) => response.data,
  });
}

export function useCreateSavedFilter(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { name: string; filter: FilterGroup; isShared?: boolean }) =>
      api<SavedFilter>(`/v1/boards/${boardId}/saved-filters`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.savedFilters(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteSavedFilter(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (filterId: string) =>
      api<undefined>(`/v1/saved-filters/${filterId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.savedFilters(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
