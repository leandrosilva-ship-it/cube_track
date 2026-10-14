/** Índices de busca global (Meilisearch). Valores de colunas customizadas NÃO são indexados. */
export const SEARCH_INDEXES = {
  items: 'items',
  boards: 'boards',
  updates: 'updates',
} as const;
export type SearchIndexName = (typeof SEARCH_INDEXES)[keyof typeof SEARCH_INDEXES];

export interface SearchIndexSettings {
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
}

export const SEARCH_INDEX_SETTINGS: Record<SearchIndexName, SearchIndexSettings> = {
  items: {
    searchableAttributes: ['name', 'boardName', 'groupName'],
    filterableAttributes: ['tenantId', 'boardId', 'workspaceId', 'assigneeIds', 'archived'],
    sortableAttributes: ['updatedAt'],
  },
  boards: {
    searchableAttributes: ['name', 'description'],
    filterableAttributes: ['tenantId', 'boardId', 'workspaceId'],
    sortableAttributes: ['updatedAt'],
  },
  updates: {
    searchableAttributes: ['bodyText', 'itemName'],
    filterableAttributes: ['tenantId', 'boardId', 'workspaceId', 'itemId', 'assigneeIds'],
    sortableAttributes: ['createdAt'],
  },
};

export interface ItemSearchDocument {
  id: string;
  tenantId: string;
  workspaceId: string;
  boardId: string;
  boardName: string;
  groupName: string;
  name: string;
  assigneeIds: string[];
  archived: boolean;
  updatedAt: number;
}

export interface BoardSearchDocument {
  id: string;
  tenantId: string;
  workspaceId: string;
  boardId: string;
  name: string;
  description: string;
  updatedAt: number;
}

export interface UpdateSearchDocument {
  id: string;
  tenantId: string;
  workspaceId: string;
  boardId: string;
  itemId: string;
  itemName: string;
  bodyText: string;
  assigneeIds: string[];
  createdAt: number;
}

/** Escapa um valor para o filtro do Meilisearch. */
export function meiliQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
