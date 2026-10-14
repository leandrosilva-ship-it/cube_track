/**
 * Chaves padronizadas do TanStack Query (ADR 0033). Tudo de um board fica sob `['boards', id]`,
 * permitindo invalidar o board inteiro (ex.: resync após lacuna de eventos) com uma chave.
 */
export interface ItemListParams {
  search?: string;
  personId?: string;
  statusLabelIds?: readonly string[];
  sort?: string;
}

export const qk = {
  me: () => ['me'] as const,
  organizations: () => ['organizations'] as const,
  members: () => ['members'] as const,
  roles: () => ['roles'] as const,
  workspaces: () => ['workspaces'] as const,
  tree: (workspaceId: string) => ['workspaces', workspaceId, 'tree'] as const,
  board: (boardId: string) => ['boards', boardId] as const,
  boardDetail: (boardId: string) => ['boards', boardId, 'detail'] as const,
  views: (boardId: string) => ['boards', boardId, 'views'] as const,
  items: (boardId: string) => ['boards', boardId, 'items'] as const,
  itemList: (boardId: string, params: ItemListParams) =>
    ['boards', boardId, 'items', params] as const,
  grants: (resourceType: string, resourceId: string) =>
    ['access-grants', resourceType, resourceId] as const,
  favorites: () => ['me', 'favorites'] as const,
  notifications: () => ['me', 'notifications'] as const,
  notificationList: (unreadOnly: boolean) =>
    ['me', 'notifications', 'list', { unreadOnly }] as const,
  unreadCount: () => ['me', 'notifications', 'unread-count'] as const,
  week: (date: string) => ['me', 'week', date] as const,
  search: (query: string) => ['search', query] as const,
};

/** Há filtros que o cache local não sabe avaliar? (então eventos invalidam em vez de inserir) */
export function isFiltered(params: ItemListParams): boolean {
  return (
    (params.search ?? '') !== '' ||
    params.personId !== undefined ||
    (params.statusLabelIds?.length ?? 0) > 0 ||
    params.sort !== undefined
  );
}
