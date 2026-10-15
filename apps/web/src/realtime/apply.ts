import type { RealtimeEvent } from '@cube-track/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { BoardDetail, Item, Page, WorkspaceTree } from '@/lib/api/types';
import { isFiltered, qk, type ItemListParams } from '@/lib/query/keys';

import { markRemoteChanges } from './highlight';

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

/** Procura um item em qualquer lista do board (cache). */
export function findCachedItem(
  queryClient: QueryClient,
  boardId: string,
  itemId: string,
): Item | undefined {
  for (const [, data] of queryClient.getQueriesData<ItemPages>({ queryKey: qk.items(boardId) })) {
    for (const page of data?.pages ?? []) {
      const found = page.data.find((entry) => entry.id === itemId);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Ajusta o contador de subitens do item pai (indicador da linha). */
export function bumpSubitemCount(
  queryClient: QueryClient,
  boardId: string,
  parentItemId: string,
  delta: number,
): void {
  patchItem(queryClient, boardId, parentItemId, (parent) =>
    parent.indicators === undefined
      ? parent
      : {
          ...parent,
          indicators: {
            ...parent.indicators,
            subitems: Math.max(0, parent.indicators.subitems + delta),
          },
        },
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
    const params = paramsOf(query.queryKey);
    // Subitens só entram na lista do pai; itens de primeiro nível só nas listas principais.
    if ((params.parentItemId ?? null) !== item.parentItemId) continue;
    if (isFiltered(params)) {
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
      typeof snapshot.createdAt === 'string'
        ? snapshot.createdAt
        : typeof snapshot.updatedAt === 'string'
          ? snapshot.updatedAt
          : new Date().toISOString(),
    updatedAt:
      typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : new Date().toISOString(),
    createdBy: (snapshot.createdBy as string | null | undefined) ?? null,
    updatedBy: (snapshot.updatedBy as string | null | undefined) ?? null,
    archivedAt: null,
    indicators: { subitems: 0, attachments: 0, updates: 0, unreadUpdates: 0 },
    redactedFields: [],
  };
}

const COSMETIC_COLUMN_CHANGES = new Set([
  'title',
  'width',
  'position',
  'description',
  'isRequired',
  'requiredWhen',
  'defaultValue',
  'permissions',
]);

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
      const created = snapshotToItem(item);
      if (findCachedItem(queryClient, boardId, created.id) !== undefined) return;
      insertItem(queryClient, boardId, created);
      if (created.parentItemId !== null)
        bumpSubitemCount(queryClient, boardId, created.parentItemId, 1);
      return;
    }
    case 'item.updated': {
      if (boardId === null || context.isOwnPendingMutation(event.clientMutationId)) return;
      const payload = event.payload as { itemId: string; version: number; changes: ItemChange[] };
      const applied: string[] = [];
      patchItem(queryClient, boardId, payload.itemId, (item) => {
        const next = applyItemChanges(item, payload.changes, payload.version);
        if (next !== item)
          for (const change of payload.changes)
            if ((next.fieldVersions[change.field] ?? 0) === change.version)
              applied.push(change.field);
        return next;
      });
      // Destaque visual nas células alteradas por outra pessoa (Gherkin do Prompt 5).
      markRemoteChanges(payload.itemId, applied);
      if (payload.changes.some((change) => change.field === 'dependencies'))
        void queryClient.invalidateQueries({ queryKey: qk.dependencies(boardId) });
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
      const { itemId } = event.payload as { itemId: string };
      const parentItemId = findCachedItem(queryClient, boardId, itemId)?.parentItemId ?? null;
      removeItem(queryClient, boardId, itemId);
      if (parentItemId !== null) bumpSubitemCount(queryClient, boardId, parentItemId, -1);
      void queryClient.invalidateQueries({ queryKey: qk.trash(boardId) });
      return;
    }
    case 'group.changed': {
      if (boardId === null) return;
      const { change } = event.payload as { change: string };
      // Renomear/colorir/recolher só muda a estrutura; os demais movem ou ocultam itens.
      void queryClient.invalidateQueries({
        queryKey: change === 'updated' ? qk.boardDetail(boardId) : qk.board(boardId),
      });
      return;
    }
    case 'column.created':
    case 'column.deleted':
      if (boardId !== null) void queryClient.invalidateQueries({ queryKey: qk.board(boardId) });
      return;
    case 'board.updated': {
      if (boardId === null) return;
      const all = (event.payload as { changes: Record<string, unknown> }).changes;
      const changes: Partial<Pick<BoardDetail, 'name' | 'description' | 'icon'>> = {};
      for (const key of ['name', 'description', 'icon'] as const)
        if (key in all) (changes as Record<string, unknown>)[key] = all[key];
      queryClient.setQueryData<BoardDetail>(qk.boardDetail(boardId), (board) =>
        board === undefined ? board : { ...board, ...changes },
      );
      // Configurações (coluna de status principal, privacidade, template) vêm do servidor.
      if (Object.keys(all).some((key) => !(key in changes)))
        void queryClient.invalidateQueries({ queryKey: qk.boardDetail(boardId) });
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
    case 'column.updated': {
      if (boardId === null) return;
      const changes = Object.keys((event.payload as { changes?: object }).changes ?? {});
      // Título, largura, posição e descrição não alteram valores: basta recarregar a estrutura.
      const cosmetic = changes.every((key) => COSMETIC_COLUMN_CHANGES.has(key));
      void queryClient.invalidateQueries({
        queryKey: cosmetic && changes.length > 0 ? qk.boardDetail(boardId) : qk.board(boardId),
      });
      return;
    }
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
