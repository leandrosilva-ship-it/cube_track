import { api } from '@/lib/api/client';
import type {
  BoardKind,
  BoardVisibility,
  Favorite,
  FavoriteType,
  TreeBoard,
  TreeFolder,
  Workspace,
  WorkspaceTree,
} from '@/lib/api/types';

export interface Neighbors {
  afterId?: string | null;
  beforeId?: string | null;
}

export const workspaceApi = {
  list: () => api<{ data: Workspace[] }>('/v1/workspaces').then((response) => response.data),
  create: (input: { name: string; description?: string }) =>
    api<Workspace>('/v1/workspaces', { method: 'POST', body: input }),
  tree: (workspaceId: string) => api<WorkspaceTree>(`/v1/workspaces/${workspaceId}/tree`),
  createFolder: (workspaceId: string, input: { name: string; parentId?: string | null }) =>
    api<TreeFolder>(`/v1/workspaces/${workspaceId}/folders`, { method: 'POST', body: input }),
  updateFolder: (
    folderId: string,
    input: { name?: string; parentId?: string | null } & Neighbors,
  ) => api<{ id: string }>(`/v1/folders/${folderId}`, { method: 'PATCH', body: input }),
  deleteFolder: (folderId: string) =>
    api<undefined>(`/v1/folders/${folderId}`, { method: 'DELETE' }),
  createBoard: (
    workspaceId: string,
    input: {
      name: string;
      folderId?: string | null;
      kind?: BoardKind;
      visibility?: BoardVisibility;
    },
  ) => api<TreeBoard>(`/v1/workspaces/${workspaceId}/boards`, { method: 'POST', body: input }),
  updateBoard: (
    boardId: string,
    input: { name?: string; description?: string | null; folderId?: string | null } & Neighbors,
  ) => api<{ id: string }>(`/v1/boards/${boardId}`, { method: 'PATCH', body: input }),
  favorites: () => api<{ data: Favorite[] }>('/v1/me/favorites').then((response) => response.data),
  addFavorite: (entityType: FavoriteType, entityId: string) =>
    api<unknown>('/v1/me/favorites', { method: 'PUT', body: { entityType, entityId } }),
  removeFavorite: (entityType: FavoriteType, entityId: string) =>
    api<undefined>(`/v1/me/favorites/${entityType}/${entityId}`, { method: 'DELETE' }),
};
