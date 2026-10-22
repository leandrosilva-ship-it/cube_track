/**
 * Chaves padronizadas do TanStack Query (ADR 0033). Tudo de um board fica sob `['boards', id]`,
 * permitindo invalidar o board inteiro (ex.: resync após lacuna de eventos) com uma chave.
 */
import type { FilterGroup } from '@cube-track/shared';

export interface ActivityFilters {
  actorId?: string;
  columnKey?: string;
  from?: string;
  to?: string;
}

export interface ItemListParams {
  search?: string;
  personId?: string;
  statusLabelIds?: readonly string[];
  /** Filtro avançado (AST E/OU) montado no construtor de filtros. */
  filter?: FilterGroup;
  /** `campo:dir[,campo:dir…]` (até 3 termos). */
  sort?: string;
  /** Lista de subitens de um item (ausente = itens de primeiro nível). */
  parentItemId?: string;
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
  shareLink: (viewId: string) => ['views', viewId, 'share-link'] as const,
  savedFilters: (boardId: string) => ['boards', boardId, 'saved-filters'] as const,
  items: (boardId: string) => ['boards', boardId, 'items'] as const,
  itemList: (boardId: string, params: ItemListParams) =>
    ['boards', boardId, 'items', params] as const,
  subitems: (boardId: string, parentItemId: string) =>
    ['boards', boardId, 'items', { parentItemId }] as const,
  trash: (boardId: string) => ['boards', boardId, 'trash'] as const,
  dependencies: (boardId: string) => ['boards', boardId, 'dependencies'] as const,
  gantt: (boardId: string) => ['boards', boardId, 'gantt'] as const,
  milestones: (boardId: string) => ['boards', boardId, 'milestones'] as const,
  baselines: (boardId: string) => ['boards', boardId, 'baselines'] as const,
  baseline: (baselineId: string) => ['baselines', baselineId] as const,
  forms: (boardId: string) => ['boards', boardId, 'forms'] as const,
  form: (formId: string) => ['forms', formId] as const,
  formFields: (formId: string) => ['forms', formId, 'fields'] as const,
  publicForm: (token: string) => ['public-forms', token] as const,
  item: (itemId: string) => ['items', itemId, 'detail'] as const,
  updates: (itemId: string) => ['items', itemId, 'updates'] as const,
  replies: (updateId: string) => ['updates', updateId, 'replies'] as const,
  activity: (itemId: string, filters: ActivityFilters) =>
    ['items', itemId, 'activity', filters] as const,
  activityActors: (itemId: string) => ['items', itemId, 'activity-actors'] as const,
  checklists: (itemId: string) => ['items', itemId, 'checklists'] as const,
  follow: (itemId: string) => ['items', itemId, 'follow'] as const,
  approvals: (itemId: string) => ['items', itemId, 'approvals'] as const,
  itemFiles: (itemId: string) => ['items', itemId, 'files'] as const,
  fileVersions: (attachmentId: string) => ['files', attachmentId, 'versions'] as const,
  boardTemplates: () => ['board-templates'] as const,
  boardsOf: (workspaceId: string) => ['workspaces', workspaceId, 'boards'] as const,
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
    (params.filter?.conditions.length ?? 0) > 0 ||
    params.sort !== undefined
  );
}
