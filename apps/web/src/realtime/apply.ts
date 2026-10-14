import type { RealtimeEvent } from '@cube-track/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { BoardDetail, Item, Page, WorkspaceTree } from '@/lib/api/types';
import { isFiltered, qk, type ItemListParams } from '@/lib/query/keys';

export type ItemPages = InfiniteData<Page<Item>, string | null>;

interface ItemChange {
  field: string;
  kind: 'column' | 'native';
  value: unknown;
  version: number;
}

/** Campos nativos que chegam nos eventos com nome diferente da propriedade do item. */
const NATIVE_FIELD_MAP: Record<string, keyof Item> = {
  name: 'name',
  group_id: 'groupId',
  position: 'position',
  plannedStartDate: 'plannedStartDate',
  plannedEndDate: 'plannedEndDate',
  replannedStartDate: 'replannedStartDate',
  replannedEndDate: 'replannedEndDate',
  actualStartDate: 'actualStartDate',
  actualEndDate: 'actualEndDate',
  progress: 'progress',
};

/**
 * Aplica mudanças por campo com LWW: só vence a versão maior que a local (o servidor é o árbitro da
 * ordem). Retorna o mesmo objeto quando nada muda (evita re-render).
 */
export function applyItemChanges(
  item: Item,
  changes: readonly ItemChange[],
  version: number,
): Item {
  let next: Item | null = null;
  for (const change of changes) {
    const current = (next ?? item).fieldVersions[change.field] ?? 0;
    if (change.version <= current) continue;
    next ??= { ...item, values: { ...item.values }, fieldVersions: { ...item.fieldVersions } };
    next.fieldVersions[change.field] = change.version;
    if (change.kind === 'column') {
      if (change.value === null || change.value === undefined)
        Reflect.deleteProperty(next.values, change.field);
      else next.values[change.field] = change.value;
      continue;
    }
    const property = NATIVE_FIELD_MAP[change.field];
    if (property !== undefined)
      (next as unknown as Record<string, unknown>)[property] = change.value;
  }
  if (next === null) return item;
  next.version = Math.max(item.version, version);
  return next;
}

function mapPages(
  data: ItemPages | undefined,
  map: (items: Item[]) => Item[],
): ItemPages | undefined {
  if (data === undefined) return data;
  const pages = data.pages.map((page) => {
    const items = map(page.data);
    return items === page.data ? page : { ...page, data: items };
  });
  return pages.some((page, index) => page !== data.pages[index]) ? { ...data, pages } : data;
}

function paramsOf(queryKey: readonly unknown[]): ItemListParams {
  const params = queryKey[3];
  return typeof params === 'object' && params !== null ? params : {};
}

/** Atualiza um item em todas as listas do board. */
export function patchItem(
  queryClient: QueryClient,
  boardId: string,
  itemId: string,
  update: (item: Item) => Item,
): void {
  queryClient.setQueriesData<ItemPages>({ queryKey: qk.items(boardId) }, (data) =>
    mapPages(data, (items) => {
      const index = items.findIndex((entry) => entry.id === itemId);
      if (index === -1) return items;
      const current = items[index];
      if (current === undefined) return items;
      const updated = update(current);
      if (updated === current) return items;
      const copy = [...items];
      copy[index] = updated;
      return copy;
    }),
  );
}

export function removeItem(queryClient: QueryClient, boardId: string, itemId: string): void {
  queryClient.setQueriesData<ItemPages>({ queryKey: qk.items(boardId) }, (data) =>
    mapPages(data, (items) =>
      items.some((entry) => entry.id === itemId)
        ? items.filter((entry) => entry.id !== itemId)
        : items,
    ),
  );
}

/**
 * Insere um item nas listas sem filtro (listas filtradas/ordenadas são invalidadas: só o servidor
 * sabe se o item entra nelas e em que posição).
 */
export function insertItem(queryClient: QueryClient, boardId: string, item: Item): void {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: qk.items(boardId) })) {
    if (isFiltered(paramsOf(query.queryKey))) {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      continue;
    }
    queryClient.setQueryData<ItemPages>(query.queryKey, (data) => {
      if (
        data === undefined ||
        data.pages.some((page) => page.data.some((entry) => entry.id === item.id))
      )
        return data;
      const [first, ...rest] = data.pages;
      if (first === undefined) return data;
      return { ...data, pages: [{ ...first, data: [...first.data, item] }, ...rest] };
    });
  }
}

function snapshotToItem(snapshot: Record<string, unknown>): Item {
  return {
    id: String(snapshot.id),
    boardId: String(snapshot.boardId),
    groupId: String(snapshot.groupId),
    parentItemId: (snapshot.parentItemId as string | null | undefined) ?? null,
    name: String(snapshot.name),
    position: String(snapshot.position),
    values: (snapshot.values as Record<string, unknown> | undefined) ?? {},
    fieldVersions: {},
    version: Number(snapshot.version ?? 1),
    plannedStartDate: (snapshot.plannedStartDate as string | null | undefined) ?? null,
    plannedEndDate: (snapshot.plannedEndDate as string | null | undefined) ?? null,
    replannedStartDate: (snapshot.replannedStartDate as string | null | undefined) ?? null,
    replannedEndDate: (snapshot.replannedEndDate as string | null | undefined) ?? null,
    actualStartDate: (snapshot.actualStartDate as string | null | undefined) ?? null,
    actualEndDate: (snapshot.actualEndDate as string | null | undefined) ?? null,
    progress: (snapshot.progress as string | null | undefined) ?? null,
    createdAt:
      typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : new Date().toISOString(),
    updatedAt:
      typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : new Date().toISOString(),
    archivedAt: null,
    redactedFields: [],
  };
}

export interface ApplyContext {
  /** Mutações otimistas desta aba ainda pendentes (o eco é ignorado; a resposta HTTP confirma). */
  isOwnPendingMutation: (clientMutationId: string | null) => boolean;
  onSessionRevoked: () => void;
  onNotification: (title: string) => void;
}

/**
 * Aplica um evento realtime ao cache do TanStack Query (patches, inserções, remoções ou
 * invalidações). Eventos de presença são tratados pelo cliente realtime.
 */
export function applyRealtimeEvent(
  queryClient: QueryClient,
  event: RealtimeEvent,
  context: ApplyContext,
): void {
  const boardId = event.scope.boardId;
  switch (event.type) {
    case 'item.created': {
      if (boardId === null || context.isOwnPendingMutation(event.clientMutationId)) return;
      const { item } = event.payload as { item: Record<string, unknown> };
      insertItem(queryClient, boardId, snapshotToItem(item));
      return;
    }
    case 'item.updated': {
      if (boardId === null || context.isOwnPendingMutation(event.clientMutationId)) return;
      const payload = event.payload as { itemId: string; version: number; changes: ItemChange[] };
      patchItem(queryClient, boardId, payload.itemId, (item) =>
        applyItemChanges(item, payload.changes, payload.version),
      );
      // Listas filtradas/ordenadas podem ganhar ou perder o item: o servidor decide.
      for (const query of queryClient.getQueryCache().findAll({ queryKey: qk.items(boardId) })) {
        if (isFiltered(paramsOf(query.queryKey))) {
          void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
        }
      }
      return;
    }
    case 'item.deleted': {
      if (boardId === null) return;
      removeItem(queryClient, boardId, (event.payload as { itemId: string }).itemId);
      return;
    }
    case 'board.updated': {
      if (boardId === null) return;
      const changes = (
        event.payload as { changes: Partial<Pick<BoardDetail, 'name' | 'description'>> }
      ).changes;
      queryClient.setQueryData<BoardDetail>(qk.boardDetail(boardId), (board) =>
        board === undefined ? board : { ...board, ...changes },
      );
      queryClient.setQueriesData<WorkspaceTree>({ queryKey: ['workspaces'] }, (tree) =>
        tree?.boards === undefined
          ? tree
          : {
              ...tree,
              boards: tree.boards.map((board) =>
                board.id === boardId ? { ...board, ...changes } : board,
              ),
            },
      );
      return;
    }
    case 'column.updated':
      if (boardId !== null) void queryClient.invalidateQueries({ queryKey: qk.board(boardId) });
      return;
    case 'view.changed':
      void queryClient.invalidateQueries({
        queryKey: qk.views((event.payload as { boardId: string }).boardId),
      });
      return;
    case 'workspace.structure_changed': {
      const { workspaceId } = event.payload as { workspaceId: string };
      void queryClient.invalidateQueries({ queryKey: qk.tree(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.workspaces(), exact: true });
      void queryClient.invalidateQueries({ queryKey: qk.favorites() });
      return;
    }
    case 'favorites.changed':
      void queryClient.invalidateQueries({ queryKey: qk.favorites() });
      return;
    case 'notification.created':
      void queryClient.invalidateQueries({ queryKey: qk.notifications() });
      context.onNotification((event.payload as { title: string }).title);
      return;
    case 'permission.changed':
      // Permissões afetam praticamente tudo o que é exibido: recarrega o que estiver ativo.
      void queryClient.invalidateQueries();
      return;
    case 'session.revoked':
      context.onSessionRevoked();
      return;
    default:
      return;
  }
}
