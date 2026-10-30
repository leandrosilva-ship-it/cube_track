'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Favorite, FavoriteType, WorkspaceTree } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import { useAuthenticated, useSession } from '@/stores/session';

import { workspaceApi, type CreateBoardInput, type UpdateWorkspaceInput } from './api';
import { applyMove, type MoveIntent } from './tree-model';

export function useWorkspaces() {
  const enabled = useAuthenticated();
  return useQuery({ queryKey: qk.workspaces(), queryFn: workspaceApi.list, enabled });
}

export function useTree(workspaceId: string | null) {
  const enabled = useAuthenticated() && workspaceId !== null;
  return useQuery({
    queryKey: qk.tree(workspaceId ?? 'none'),
    queryFn: () => workspaceApi.tree(workspaceId ?? ''),
    enabled,
  });
}

export function useFavorites() {
  const enabled = useAuthenticated();
  return useQuery({ queryKey: qk.favorites(), queryFn: workspaceApi.favorites, enabled });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: workspaceApi.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.workspaces(), exact: true }),
  });
}

/** Ajustes do workspace, incluindo módulos opcionais (ADR 0017/0054) — exige `workspace.manage`. */
export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => workspaceApi.update(workspaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.workspaces(), exact: true });
      void queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) });
    },
  });
}

export function useCreateFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      workspaceApi.createFolder(workspaceId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) }),
  });
}

export function useCreateBoard(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBoardInput) => workspaceApi.createBoard(workspaceId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) }),
  });
}

/** Mover board/pasta na árvore com update otimista e rollback em erro. */
export function useMoveNode(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (intent: MoveIntent) =>
      intent.type === 'board'
        ? workspaceApi.updateBoard(intent.id, {
            folderId: intent.folderId,
            ...(intent.beforeId === undefined ? {} : { beforeId: intent.beforeId }),
          })
        : workspaceApi.updateFolder(intent.id, { parentId: intent.parentId }),
    onMutate: async (intent) => {
      const key = qk.tree(workspaceId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WorkspaceTree>(key);
      if (previous !== undefined) queryClient.setQueryData(key, applyMove(previous, intent));
      return { previous };
    },
    onError: (error, _intent, context) => {
      if (context?.previous !== undefined)
        queryClient.setQueryData(qk.tree(workspaceId), context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) }),
  });
}

export function useRenameNode(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, name }: { type: 'board' | 'folder'; id: string; name: string }) =>
      type === 'board'
        ? workspaceApi.updateBoard(id, { name })
        : workspaceApi.updateFolder(id, { name }),
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) });
      if (variables.type === 'board')
        await queryClient.invalidateQueries({ queryKey: qk.board(variables.id) });
    },
  });
}

export function useDeleteFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: workspaceApi.deleteFolder,
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) }),
  });
}

/** Favoritar/desfavoritar com update otimista. */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: async (input: {
      entityType: FavoriteType;
      entityId: string;
      name: string;
      workspaceId: string;
      favorite: boolean;
    }) => {
      if (input.favorite) await workspaceApi.addFavorite(input.entityType, input.entityId);
      else await workspaceApi.removeFavorite(input.entityType, input.entityId);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: qk.favorites() });
      const previous = queryClient.getQueryData<Favorite[]>(qk.favorites());
      queryClient.setQueryData<Favorite[]>(qk.favorites(), (current = []) =>
        input.favorite
          ? [
              ...current.filter((entry) => entry.entityId !== input.entityId),
              {
                entityType: input.entityType,
                entityId: input.entityId,
                name: input.name,
                workspaceId: input.workspaceId,
              },
            ]
          : current.filter((entry) => entry.entityId !== input.entityId),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(qk.favorites(), context?.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.favorites() }),
  });
}

export function useBoardTemplates(enabled: boolean) {
  const authenticated = useSession((state) => state.status === 'authenticated');
  return useQuery({
    queryKey: qk.boardTemplates(),
    queryFn: () => workspaceApi.templates(),
    enabled: enabled && authenticated,
    staleTime: 5 * 60_000,
  });
}
