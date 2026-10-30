import { api } from '@/lib/api/client';
import type {
  BoardKind,
  BoardTemplates,
  BoardVisibility,
  Favorite,
  FavoriteType,
  TreeBoard,
  TreeFolder,
  Workspace,
  WorkspaceTree,
} from '@/lib/api/types';

export interface CreateBoardInput {
  name: string;
  description?: string;
  icon?: string | null;
  folderId?: string | null;
  kind?: BoardKind;
  visibility?: BoardVisibility;
  template?:
    | { kind: 'builtin'; key: string }
    | { kind: 'board'; boardId: string; includeItems?: boolean };
}

export interface Neighbors {
  afterId?: string | null;
  beforeId?: string | null;
}

export interface UpdateWorkspaceInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  visibility?: Workspace['visibility'];
  /** Sempre inclui `'core'` (ADR 0017/0054). */
  enabledModules?: string[];
}

export const workspaceApi = {
  list: () => api<{ data: Workspace[] }>('/v1/workspaces').then((response) => response.data),
  create: (input: { name: string; description?: string }) =>
    api<Workspace>('/v1/workspaces', { method: 'POST', body: input }),
  update: (workspaceId: string, input: UpdateWorkspaceInput) =>
    api<Workspace>(`/v1/workspaces/${workspaceId}`, { method: 'PATCH', body: input }),
  tree: (workspaceId: string) => api<WorkspaceTree>(`/v1/workspaces/${workspaceId}/tree`),
  createFolder: (workspaceId: string, input: { name: string; parentId?: string | null }) =>
    api<TreeFolder>(`/v1/workspaces/${workspaceId}/folders`, { method: 'POST', body: input }),
  updateFolder: (
    folderId: string,
    input: { name?: string; parentId?: string | null } & Neighbors,
  ) => api<{ id: string }>(`/v1/folders/${folderId}`, { method: 'PATCH', body: input }),
  deleteFolder: (folderId: string) =>
    api<undefined>(`/v1/folders/${folderId}`, { method: 'DELETE' }),
  createBoard: (workspaceId: string, input: CreateBoardInput) =>
    api<TreeBoard>(`/v1/workspaces/${workspaceId}/boards`, { method: 'POST', body: input }),
  templates: () => api<BoardTemplates>('/v1/board-templates'),
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
