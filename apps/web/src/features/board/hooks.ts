'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { BoardDetail, ViewList, ViewType } from '@/lib/api/types';
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
