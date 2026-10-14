'use client';

import { toast } from '@cube-track/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { api } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import type { BoardDetail, Item, Page, ViewList, ViewType } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { isFiltered, qk, type ItemListParams } from '@/lib/query/keys';
import { patchItem, removeItem, type ItemPages } from '@/realtime/apply';
import { releaseMutation, trackMutation } from '@/realtime/pending';
import { useSession } from '@/stores/session';

import { buildItemQuery } from './query-builder';

const PAGE_SIZE = 100;

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

export function useItems(board: BoardDetail | undefined, params: ItemListParams) {
  const boardId = board?.id ?? 'none';
  return useInfiniteQuery({
    queryKey: qk.itemList(boardId, params),
    enabled: board !== undefined,
    initialPageParam: null,
    getNextPageParam: (last: Page<Item>) => last.pageInfo.nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api<Page<Item>>(`/v1/boards/${boardId}/items`, {
        signal,
        query: {
          limit: PAGE_SIZE,
          cursor: pageParam,
          ...buildItemQuery(params, board?.columns ?? []),
        },
      }),
  });
}

function unfilteredLists(queryClient: ReturnType<typeof useQueryClient>, boardId: string) {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: qk.items(boardId) })
    .filter((query) => {
      const params = query.queryKey[3];
      return !isFiltered(typeof params === 'object' && params !== null ? params : {});
    });
}

/** Cria item com update otimista (id temporário) e confirmação/rollback. */
export function useCreateItem(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({
      groupId,
      name,
      mutationId,
    }: {
      groupId: string;
      name: string;
      mutationId: string;
      tempId: string;
    }) =>
      api<Item>(`/v1/boards/${boardId}/items`, {
        method: 'POST',
        body: { groupId, name },
        clientMutationId: mutationId,
        idempotencyKey: mutationId,
      }),
    onMutate: ({ groupId, name, mutationId, tempId }) => {
      trackMutation(mutationId);
      const now = new Date().toISOString();
      const optimistic: Item = {
        id: tempId,
        boardId,
        groupId,
        parentItemId: null,
        name,
        position: '￿',
        values: {},
        fieldVersions: {},
        version: 0,
        plannedStartDate: null,
        plannedEndDate: null,
        replannedStartDate: null,
        replannedEndDate: null,
        actualStartDate: null,
        actualEndDate: null,
        progress: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        redactedFields: [],
      };
      for (const query of unfilteredLists(queryClient, boardId)) {
        queryClient.setQueryData<ItemPages>(query.queryKey, (data) => {
          const [first, ...rest] = data?.pages ?? [];
          if (data === undefined || first === undefined) return data;
          return { ...data, pages: [{ ...first, data: [...first.data, optimistic] }, ...rest] };
        });
      }
    },
    onSuccess: (item, { tempId }) => {
      patchItem(queryClient, boardId, tempId, () => item);
    },
    onError: (error, { tempId }) => {
      removeItem(queryClient, boardId, tempId);
      toast.error(errorMessage(error));
    },
    onSettled: (_item, _error, { mutationId }) => {
      releaseMutation(mutationId);
    },
  });
}

/**
 * Renomeia com LWW por campo: envia a versão-base; em 409 aplica o valor atual do servidor e avisa
 * (reconciliação), em outros erros desfaz o patch otimista.
 */
export function useRenameItem(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const t = useTranslations('errors');
  return useMutation({
    mutationFn: ({ item, name, mutationId }: { item: Item; name: string; mutationId: string }) =>
      api<Item>(`/v1/items/${item.id}`, {
        method: 'PATCH',
        body: { name, baseVersions: { name: item.fieldVersions.name ?? 0 } },
        clientMutationId: mutationId,
      }),
    onMutate: ({ item, name, mutationId }) => {
      trackMutation(mutationId);
      patchItem(queryClient, boardId, item.id, (current) => ({ ...current, name }));
      return { previous: item };
    },
    onSuccess: (updated) => {
      patchItem(queryClient, boardId, updated.id, () => updated);
    },
    onError: (error, { item }) => {
      if (isApiError(error, 409)) {
        const current = (error.problem.current as Item | undefined) ?? item;
        patchItem(queryClient, boardId, item.id, () => current);
        toast.warning(t('conflict'));
        return;
      }
      patchItem(queryClient, boardId, item.id, () => item);
      toast.error(errorMessage(error));
    },
    onSettled: (_item, _error, { mutationId }) => {
      releaseMutation(mutationId);
    },
  });
}

export function useUpdateBoardDetails(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { name?: string; description?: string | null }) =>
      api<unknown>(`/v1/boards/${boardId}`, { method: 'PATCH', body: input }),
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
