'use client';

import {
  missingRequiredColumns,
  type CellTextDirectory,
  type CellTextLocale,
} from '@cube-track/shared';
import { toast } from '@cube-track/ui';
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo } from 'react';

import { api, newMutationId } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import type {
  BoardColumn,
  BoardDetail,
  BoardGroup,
  Dependency,
  Item,
  Page,
  Trash,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { isFiltered, qk, type ItemListParams } from '@/lib/query/keys';
import {
  bumpSubitemCount,
  insertItem,
  patchItem,
  removeItem,
  type ItemPages,
} from '@/realtime/apply';
import { releaseMutation, trackMutation } from '@/realtime/pending';
import { useSession } from '@/stores/session';

import { useMe, useMembers } from '../shell/hooks';
import { buildItemQuery } from '../board/query-builder';
import {
  applyCellWrite,
  cellValue,
  cellWrite,
  requirementColumns,
  todayIn,
  toItemState,
} from './model';
import { requestRequiredValues } from './required-prompt';
import { pushUndo } from './undo';

/** Página grande: a Tabela carrega progressivamente até o fim (virtualização cuida do DOM). */
export const TABLE_PAGE_SIZE = 500;
const BULK_CHUNK = 500;

// ---------------------------------------------------------------------------------- leitura ---

export function useTableItems(board: BoardDetail | undefined, params: ItemListParams) {
  const boardId = board?.id ?? 'none';
  const query = useInfiniteQuery({
    queryKey: qk.itemList(boardId, params),
    enabled: board !== undefined,
    initialPageParam: null as string | null,
    getNextPageParam: (last: Page<Item>) => last.pageInfo.nextCursor,
    queryFn: ({ pageParam, signal }) =>
      api<Page<Item>>(`/v1/boards/${boardId}/items`, {
        signal,
        query: {
          limit: TABLE_PAGE_SIZE,
          cursor: pageParam,
          indicators: true,
          ...buildItemQuery(params, board?.columns ?? []),
        },
      }),
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = query;
  // Carregamento progressivo: a primeira página aparece já; as demais chegam em sequência.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  const items = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.data), [query.data]);
  return { ...query, items };
}

/** Subitens dos itens expandidos (uma consulta por pai, no mesmo formato paginado do cache). */
export function useSubitems(board: BoardDetail, parentIds: readonly string[]) {
  const results = useQueries({
    queries: parentIds.map((parentItemId) => ({
      queryKey: qk.subitems(board.id, parentItemId),
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ItemPages> => {
        const page = await api<Page<Item>>(`/v1/boards/${board.id}/items`, {
          signal,
          query: { limit: TABLE_PAGE_SIZE, parentItemId, indicators: true },
        });
        return { pages: [page], pageParams: [null] };
      },
    })),
  });
  return useMemo(() => {
    const map = new Map<string, Item[]>();
    parentIds.forEach((parentId, index) => {
      const data = results[index]?.data;
      if (data !== undefined)
        map.set(
          parentId,
          data.pages.flatMap((page) => page.data),
        );
    });
    return map;
  }, [parentIds, results]);
}

/** Diretório de nomes (pessoas e itens carregados) para formatar, colar e importar valores. */
export function useDirectory(items: readonly Item[]): CellTextDirectory {
  const members = useMembers();
  return useMemo(
    () => ({
      people: (members.data ?? []).map((member) => ({
        id: member.userId,
        name: member.name,
        email: member.email,
      })),
      teams: [],
      items: items.map((item) => ({ id: item.id, name: item.name })),
    }),
    [members.data, items],
  );
}

export function useCellLocale(): CellTextLocale {
  const locale = useLocale();
  return locale === 'en' || locale === 'es' ? locale : 'pt-BR';
}

/** Nome de um item de outro board (colunas de relação), com cache longo. */
export function useItemName(itemId: string, known: string | undefined) {
  const enabled = useSession((state) => state.status === 'authenticated') && known === undefined;
  return useQuery({
    queryKey: ['item-name', itemId],
    queryFn: () => api<Item>(`/v1/items/${itemId}`).then((item) => item.name),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useTrash(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.trash(boardId),
    queryFn: () => api<Trash>(`/v1/boards/${boardId}/trash`),
    enabled,
  });
}

export function useDependencies(boardId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.dependencies(boardId),
    queryFn: () =>
      api<{ data: Dependency[] }>(`/v1/boards/${boardId}/dependencies`).then(
        (response) => response.data,
      ),
    enabled,
  });
}

/** Boards do workspace (destino de "mover para outro board"). */
export function useWorkspaceBoards(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.boardsOf(workspaceId),
    queryFn: () =>
      api<{ data: { id: string; name: string }[] }>(`/v1/workspaces/${workspaceId}/boards`).then(
        (response) => response.data,
      ),
    enabled,
  });
}

// -------------------------------------------------------------------------------- escritas ---

/** Mudança de uma célula/linha: nome e/ou valores por chave de coluna (null limpa). */
export interface ItemWrite {
  item: Item;
  name?: string;
  /** Mover para outro grupo/raia (usado pelo Kanban ao arrastar entre raias). */
  groupId?: string;
  /** Reordenar entre vizinhos (usado pelo Kanban ao arrastar dentro da mesma coluna/raia). */
  position?: { afterId?: string; beforeId?: string };
  values: Record<string, Record<string, unknown> | null>;
}

interface WireUpdate {
  id: string;
  name?: string;
  groupId?: string;
  position?: { afterId?: string; beforeId?: string };
  values?: Record<string, unknown>;
  fields?: Record<string, string | null>;
  baseVersions?: Record<string, number>;
}

function columnMap(board: BoardDetail): Map<string, BoardColumn> {
  return new Map(board.columns.map((column) => [column.key, column]));
}

function applyWrite(board: BoardDetail, write: ItemWrite): Item {
  const columns = columnMap(board);
  let next = write.name === undefined ? write.item : { ...write.item, name: write.name };
  if (write.groupId !== undefined) next = { ...next, groupId: write.groupId };
  for (const [key, value] of Object.entries(write.values)) {
    const column = columns.get(key);
    if (column !== undefined) next = applyCellWrite(next, column, value);
  }
  return next;
}

function toWire(board: BoardDetail, write: ItemWrite, conditional: boolean): WireUpdate {
  const columns = columnMap(board);
  const values: Record<string, unknown> = {};
  const fields: Record<string, string | null> = {};
  const baseVersions: Record<string, number> = {};
  for (const [key, value] of Object.entries(write.values)) {
    const column = columns.get(key);
    if (column === undefined) continue;
    const part = cellWrite(column, value);
    Object.assign(values, part.values ?? {});
    Object.assign(fields, part.fields ?? {});
    if (part.values !== undefined) baseVersions[key] = write.item.fieldVersions[key] ?? 0;
  }
  if (write.name !== undefined) baseVersions.name = write.item.fieldVersions.name ?? 0;
  if (write.groupId !== undefined) baseVersions.group_id = write.item.fieldVersions.group_id ?? 0;
  return {
    id: write.item.id,
    ...(write.name === undefined ? {} : { name: write.name }),
    ...(write.groupId === undefined ? {} : { groupId: write.groupId }),
    ...(write.position === undefined ? {} : { position: write.position }),
    ...(Object.keys(values).length === 0 ? {} : { values }),
    ...(Object.keys(fields).length === 0 ? {} : { fields }),
    ...(conditional ? { baseVersions } : {}),
  };
}

/** Escrita inversa (valores anteriores dos mesmos campos), para desfazer. */
function inverseOf(board: BoardDetail, write: ItemWrite): ItemWrite {
  const columns = columnMap(board);
  const values: ItemWrite['values'] = {};
  for (const key of Object.keys(write.values)) {
    const column = columns.get(key);
    if (column !== undefined)
      values[key] = (cellValue(write.item, column) as Record<string, unknown> | null) ?? null;
  }
  return {
    item: applyWrite(board, write),
    ...(write.name === undefined ? {} : { name: write.item.name }),
    ...(write.groupId === undefined ? {} : { groupId: write.item.groupId }),
    values,
  };
}

function cachedItem(queryClient: QueryClient, boardId: string, itemId: string): Item | undefined {
  for (const [, data] of queryClient.getQueriesData<ItemPages>({ queryKey: qk.items(boardId) }))
    for (const page of data?.pages ?? []) {
      const found = page.data.find((entry) => entry.id === itemId);
      if (found !== undefined) return found;
    }
  return undefined;
}

interface RequiredProblem {
  fields?: { key: string; title: string }[];
}

/** Mantém o item do painel (`qk.item`, aberto num drawer) em sincronia com a própria escrita. */
function patchStandaloneItem(queryClient: QueryClient, updated: Item): void {
  queryClient.setQueryData<Item>(qk.item(updated.id), (current) =>
    current === undefined
      ? current
      : { ...updated, ...(current.indicators === undefined ? {} : { indicators: current.indicators }) },
  );
}

/**
 * Escritas da Tabela: otimistas, condicionais por campo (LWW, ADR 0008), com pedido de campos
 * obrigatórios antes de salvar (ADR 0039) e registro para desfazer.
 */
export function useItemWriter(board: BoardDetail) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const t = useTranslations('table');
  const te = useTranslations('errors');
  const me = useMe();
  const userId = useSession((state) => state.user?.id ?? '');
  const timezone = me.data?.user.timezone ?? 'America/Sao_Paulo';

  const context = useMemo(
    () => ({ currentUserId: userId, today: todayIn(timezone) }),
    [userId, timezone],
  );

  /** Completa obrigatórios pendentes; `null` = a pessoa cancelou. */
  const fillRequired = useCallback(
    async (writes: ItemWrite[]): Promise<ItemWrite[] | null> => {
      const requirements = requirementColumns(board);
      const missingKeys = new Set<string>();
      const affected: ItemWrite[] = [];
      for (const write of writes) {
        const touched = new Set([
          ...Object.keys(write.values),
          ...(write.name === undefined ? [] : ['name']),
        ]);
        const missing = missingRequiredColumns(
          requirements,
          toItemState(board, write.item),
          toItemState(board, applyWrite(board, write)),
          touched,
          context,
        );
        if (missing.length === 0) continue;
        affected.push(write);
        for (const column of missing) missingKeys.add(column.key);
      }
      if (missingKeys.size === 0) return writes;
      const first = affected[0];
      const filled = await requestRequiredValues({
        board,
        itemName:
          affected.length === 1 && first !== undefined
            ? (first.name ?? first.item.name)
            : t('required.manyItems', { count: affected.length }),
        columns: board.columns.filter((column) => missingKeys.has(column.key)),
        initial: first === undefined ? {} : applyWrite(board, first).values,
      });
      if (filled === null) return null;
      return writes.map((write) =>
        affected.includes(write) ? { ...write, values: { ...write.values, ...filled } } : write,
      );
    },
    [board, context, t],
  );

  /** Envia escritas sem prompts nem desfazer (usado também pelo próprio desfazer). */
  const send = useCallback(
    async (writes: ItemWrite[], conditional: boolean): Promise<void> => {
      if (writes.length === 0) return;
      const mutationId = newMutationId();
      trackMutation(mutationId);
      for (const write of writes)
        patchItem(queryClient, board.id, write.item.id, (current) =>
          applyWrite(board, { ...write, item: current }),
        );
      try {
        if (writes.length === 1 && writes[0] !== undefined) {
          const { id, ...body } = toWire(board, writes[0], conditional);
          const updated = await api<Item>(`/v1/items/${id}`, {
            method: 'PATCH',
            body,
            clientMutationId: mutationId,
          });
          patchItem(queryClient, board.id, updated.id, (current) => ({
            ...updated,
            ...(current.indicators === undefined ? {} : { indicators: current.indicators }),
          }));
          patchStandaloneItem(queryClient, updated);
          return;
        }
        for (let offset = 0; offset < writes.length; offset += BULK_CHUNK) {
          const chunk = writes.slice(offset, offset + BULK_CHUNK);
          const response = await api<{ data: Item[] }>(`/v1/boards/${board.id}/items`, {
            method: 'PATCH',
            body: { items: chunk.map((write) => toWire(board, write, false)) },
            clientMutationId: mutationId,
          });
          for (const updated of response.data) {
            patchItem(queryClient, board.id, updated.id, (current) => ({
              ...updated,
              ...(current.indicators === undefined ? {} : { indicators: current.indicators }),
            }));
            patchStandaloneItem(queryClient, updated);
          }
        }
      } catch (error) {
        if (isApiError(error, 409) && writes.length === 1) {
          const current = error.problem.current as Item | undefined;
          if (current !== undefined)
            patchItem(queryClient, board.id, current.id, (cached) => ({
              ...current,
              ...(cached.indicators === undefined ? {} : { indicators: cached.indicators }),
            }));
          toast.warning(te('conflict'));
          throw error;
        }
        for (const write of writes)
          patchItem(queryClient, board.id, write.item.id, (current) => {
            const reverted = inverseOf(board, { ...write, item: write.item });
            return applyWrite(board, { ...reverted, item: current });
          });
        throw error;
      } finally {
        releaseMutation(mutationId);
      }
    },
    [board, queryClient, te],
  );

  /** Grava células/linhas: obrigatórios → otimista → API → desfazer. */
  const write = useCallback(
    async (input: ItemWrite[], label: string): Promise<boolean> => {
      const writes = input.filter(
        (entry) => entry.name !== undefined || Object.keys(entry.values).length > 0,
      );
      if (writes.length === 0) return true;
      const completed = await fillRequired(writes);
      if (completed === null) return false;
      try {
        await send(completed, true);
      } catch (error) {
        const problem = isApiError(error, 422) ? (error.problem as RequiredProblem) : null;
        if (problem?.fields !== undefined && error instanceof Error && isApiError(error)) {
          // O servidor sabe de algo que o cliente não sabia (ex.: regra alterada agora).
          const keys = new Set(problem.fields.map((field) => field.key));
          const first = completed[0];
          const filled = await requestRequiredValues({
            board,
            itemName: first?.name ?? first?.item.name ?? '',
            columns: board.columns.filter((column) => keys.has(column.key)),
            initial: first === undefined ? {} : applyWrite(board, first).values,
          });
          if (filled === null) return false;
          const retried = completed.map((entry) => ({
            ...entry,
            values: { ...entry.values, ...filled },
          }));
          await send(retried, false);
          pushUndo(board.id, {
            label,
            undo: () =>
              send(
                retried.map((entry) => inverseOf(board, entry)),
                false,
              ),
            redo: () => send(retried, false),
          });
          return true;
        }
        if (!isApiError(error, 409)) toast.error(errorMessage(error));
        return false;
      }
      pushUndo(board.id, {
        label,
        undo: () =>
          send(
            completed.map((entry) => {
              const current = cachedItem(queryClient, board.id, entry.item.id);
              const inverse = inverseOf(board, entry);
              return current === undefined ? inverse : { ...inverse, item: current };
            }),
            false,
          ),
        redo: () =>
          send(
            completed.map((entry) => ({
              ...entry,
              item: cachedItem(queryClient, board.id, entry.item.id) ?? entry.item,
            })),
            false,
          ),
      });
      return true;
    },
    [board, errorMessage, fillRequired, queryClient, send],
  );

  return { write, send, context };
}

// ------------------------------------------------------------------------- criar itens ---

const EMPTY_INDICATORS = { subitems: 0, attachments: 0, updates: 0, unreadUpdates: 0 };

function optimisticItem(board: BoardDetail, input: CreateInput, tempId: string): Item {
  const now = new Date().toISOString();
  return {
    id: tempId,
    boardId: board.id,
    groupId: input.groupId,
    parentItemId: input.parentItemId ?? null,
    name: input.name,
    position: '￿',
    values: input.values ?? {},
    fieldVersions: {},
    version: 0,
    descriptionText: null,
    plannedStartDate: null,
    plannedEndDate: null,
    replannedStartDate: null,
    replannedEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    progress: null,
    isMilestone: false,
    scheduleMode: 'auto',
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    archivedAt: null,
    indicators: EMPTY_INDICATORS,
    redactedFields: [],
  };
}

export interface CreateInput {
  groupId: string;
  name: string;
  parentItemId?: string | null;
  values?: Record<string, unknown>;
  afterId?: string;
}

/** Valores padrão das colunas (aplicados também pelo servidor) para a checagem de obrigatórios. */
export function defaultValues(board: BoardDetail): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const column of board.columns) {
    if (column.defaultValue !== null) values[column.key] = column.defaultValue;
    else if (column.type === 'status' && typeof column.settings.defaultLabelId === 'string')
      values[column.key] = { labelId: column.settings.defaultLabelId };
  }
  return values;
}

export function useCreateTableItem(board: BoardDetail) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const t = useTranslations('table');
  const { context } = useItemWriter(board);

  return useCallback(
    async (input: CreateInput): Promise<Item | null> => {
      let values = { ...(input.values ?? {}) };
      // Subitens não seguem a obrigatoriedade das colunas do item (mesma regra do servidor).
      if ((input.parentItemId ?? null) === null) {
        const draft = optimisticItem(
          board,
          { ...input, values: { ...defaultValues(board), ...values } },
          'draft',
        );
        const missing = missingRequiredColumns(
          requirementColumns(board),
          null,
          toItemState(board, draft),
          new Set(Object.keys(values)),
          context,
        );
        if (missing.length > 0) {
          const keys = new Set(missing.map((column) => column.key));
          const filled = await requestRequiredValues({
            board,
            itemName: input.name,
            columns: board.columns.filter((column) => keys.has(column.key)),
            initial: draft.values,
          });
          if (filled === null) return null;
          values = { ...values, ...filled };
        }
      }
      const mutationId = newMutationId();
      const tempId = `temp-${mutationId}`;
      trackMutation(mutationId);
      insertItem(queryClient, board.id, optimisticItem(board, { ...input, values }, tempId));
      try {
        const created = await api<Item>(`/v1/boards/${board.id}/items`, {
          method: 'POST',
          body: {
            groupId: input.groupId,
            name: input.name,
            ...(input.parentItemId === undefined || input.parentItemId === null
              ? {}
              : { parentItemId: input.parentItemId }),
            ...(Object.keys(values).length === 0 ? {} : { values }),
            ...(input.afterId === undefined ? {} : { position: { afterId: input.afterId } }),
          },
          clientMutationId: mutationId,
          idempotencyKey: mutationId,
        });
        patchItem(queryClient, board.id, tempId, () => ({
          ...created,
          indicators: created.indicators ?? EMPTY_INDICATORS,
        }));
        if (created.parentItemId !== null)
          bumpSubitemCount(queryClient, board.id, created.parentItemId, 1);
        pushUndo(board.id, {
          label: t('undo.create', { name: created.name }),
          undo: () =>
            itemAction(queryClient, board.id, { action: 'delete', itemIds: [created.id] }).then(
              () => undefined,
            ),
          redo: () =>
            itemAction(queryClient, board.id, { action: 'restore', itemIds: [created.id] }).then(
              () => undefined,
            ),
        });
        return created;
      } catch (error) {
        removeItem(queryClient, board.id, tempId);
        toast.error(errorMessage(error));
        return null;
      } finally {
        releaseMutation(mutationId);
      }
    },
    [board, context, errorMessage, queryClient, t],
  );
}

// ---------------------------------------------------------------------- ações de itens ---

export type ItemActionBody =
  | { action: 'duplicate'; itemIds: string[]; includeSubitems?: boolean }
  | { action: 'archive' | 'unarchive' | 'delete' | 'restore'; itemIds: string[] }
  | {
      action: 'move';
      itemIds: string[];
      target: { boardId: string; groupId: string; columnMapping?: Record<string, string | null> };
    };

/** Executa uma ação em lote e aplica o resultado ao cache. */
export async function itemAction(
  queryClient: QueryClient,
  boardId: string,
  body: ItemActionBody,
): Promise<Item[]> {
  const mutationId = newMutationId();
  trackMutation(mutationId);
  const parents = new Map<string, string>();
  for (const id of body.itemIds) {
    const parent = cachedItem(queryClient, boardId, id)?.parentItemId;
    if (parent !== undefined && parent !== null) parents.set(id, parent);
  }
  const removes =
    body.action === 'delete' ||
    body.action === 'archive' ||
    (body.action === 'move' && body.target.boardId !== boardId);
  const snapshot = removes
    ? body.itemIds.flatMap((id) => {
        const item = cachedItem(queryClient, boardId, id);
        return item === undefined ? [] : [item];
      })
    : [];
  if (removes) for (const id of body.itemIds) removeItem(queryClient, boardId, id);
  try {
    const response = await api<{ items: Item[] }>(`/v1/boards/${boardId}/items/actions`, {
      method: 'POST',
      body,
      clientMutationId: mutationId,
    });
    if (removes) {
      for (const [, parent] of parents) bumpSubitemCount(queryClient, boardId, parent, -1);
      void queryClient.invalidateQueries({ queryKey: qk.trash(boardId) });
    } else {
      for (const item of response.items) {
        if (item.boardId !== boardId) continue;
        const known = cachedItem(queryClient, boardId, item.id) !== undefined;
        if (known) patchItem(queryClient, boardId, item.id, (current) => ({ ...current, ...item }));
        else
          insertItem(queryClient, boardId, {
            ...item,
            indicators: item.indicators ?? EMPTY_INDICATORS,
          });
      }
      // Ordem/posições novas: listas ordenadas no servidor se reorganizam.
      for (const query of queryClient.getQueryCache().findAll({ queryKey: qk.items(boardId) })) {
        const params = query.queryKey[3];
        if (typeof params === 'object' && params !== null && isFiltered(params))
          void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      }
    }
    return response.items;
  } catch (error) {
    for (const item of snapshot) insertItem(queryClient, boardId, item);
    throw error;
  } finally {
    releaseMutation(mutationId);
  }
}

export function useItemActions(board: BoardDetail) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const t = useTranslations('table');

  return useCallback(
    async (body: ItemActionBody): Promise<Item[] | null> => {
      const before = new Map(
        body.itemIds.map((id) => [id, cachedItem(queryClient, board.id, id)] as const),
      );
      let result: Item[];
      try {
        result = await itemAction(queryClient, board.id, body);
      } catch (error) {
        toast.error(errorMessage(error));
        return null;
      }
      const count = body.itemIds.length;
      const run = (next: ItemActionBody) =>
        itemAction(queryClient, board.id, next).then(() => undefined);
      switch (body.action) {
        case 'delete':
          pushUndo(board.id, {
            label: t('undo.delete', { count }),
            undo: () => run({ action: 'restore', itemIds: body.itemIds }),
            redo: () => run(body),
          });
          toast.success(t('actions.deleted', { count }), {
            action: {
              label: t('undo.action'),
              onClick: () => {
                void run({ action: 'restore', itemIds: body.itemIds });
              },
            },
          });
          break;
        case 'archive':
          pushUndo(board.id, {
            label: t('undo.archive', { count }),
            undo: () => run({ action: 'unarchive', itemIds: body.itemIds }),
            redo: () => run(body),
          });
          toast.success(t('actions.archived', { count }));
          break;
        case 'duplicate': {
          const created = result.map((item) => item.id);
          pushUndo(board.id, {
            label: t('undo.duplicate', { count }),
            undo: () => run({ action: 'delete', itemIds: created }),
            redo: () => run({ action: 'restore', itemIds: created }),
          });
          break;
        }
        case 'move': {
          if (body.target.boardId !== board.id) {
            toast.success(t('actions.movedBoard', { count }));
            break;
          }
          const origins = new Map<string, string[]>();
          for (const [id, item] of before) {
            if (item === undefined) continue;
            origins.set(item.groupId, [...(origins.get(item.groupId) ?? []), id]);
          }
          pushUndo(board.id, {
            label: t('undo.move', { count }),
            undo: async () => {
              for (const [groupId, itemIds] of origins)
                await run({ action: 'move', itemIds, target: { boardId: board.id, groupId } });
            },
            redo: () => run(body),
          });
          break;
        }
        case 'restore':
          pushUndo(board.id, {
            label: t('undo.restore', { count }),
            undo: () => run({ action: 'delete', itemIds: body.itemIds }),
            redo: () => run(body),
          });
          toast.success(t('actions.restored', { count }));
          break;
        case 'unarchive':
          toast.success(t('actions.unarchived', { count }));
          break;
      }
      return result;
    },
    [board.id, errorMessage, queryClient, t],
  );
}

/** Cronômetro (coluna de tempo rastreado): o servidor calcula as horas. */
export function useTimer(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({
      itemId,
      columnKey,
      action,
    }: {
      itemId: string;
      columnKey: string;
      action: 'start' | 'stop';
    }) => api<Item>(`/v1/items/${itemId}/timer/${columnKey}`, { method: 'POST', body: { action } }),
    onSuccess: (item) => {
      patchItem(queryClient, boardId, item.id, (current) => ({
        ...item,
        ...(current.indicators === undefined ? {} : { indicators: current.indicators }),
      }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useSetDependencies(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({
      itemId,
      predecessors,
    }: {
      itemId: string;
      predecessors: { itemId: string; type: Dependency['type']; lagDays: number }[];
    }) =>
      api<unknown>(`/v1/items/${itemId}/dependencies`, { method: 'PUT', body: { predecessors } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.dependencies(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Marca as atualizações do item como vistas (indicador de não lidas). */
export function useMarkSeen(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api<undefined>(`/v1/items/${itemId}/seen`, { method: 'POST' }),
    onSuccess: (_result, itemId) => {
      patchItem(queryClient, boardId, itemId, (item) =>
        item.indicators === undefined || item.indicators.unreadUpdates === 0
          ? item
          : { ...item, indicators: { ...item.indicators, unreadUpdates: 0 } },
      );
    },
  });
}

// --------------------------------------------------------------------------- estrutura ---

function useBoardMutation<TInput, TResult>(
  boardId: string,
  mutationFn: (input: TInput) => Promise<TResult>,
  options: {
    optimistic?: (board: BoardDetail, input: TInput) => BoardDetail;
    reloadItems?: boolean;
  } = {},
) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn,
    onMutate: (input) => {
      const previous = queryClient.getQueryData<BoardDetail>(qk.boardDetail(boardId));
      if (options.optimistic !== undefined && previous !== undefined)
        queryClient.setQueryData(qk.boardDetail(boardId), options.optimistic(previous, input));
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined)
        queryClient.setQueryData(qk.boardDetail(boardId), context.previous);
      toast.error(errorMessage(error));
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: options.reloadItems === true ? qk.board(boardId) : qk.boardDetail(boardId),
      }),
  });
}

export interface ColumnInput {
  type?: string;
  title?: string;
  description?: string | null;
  settings?: Record<string, unknown>;
  width?: number | null;
  position?: { afterKey?: string; beforeKey?: string };
  labels?: { label: string; color: string; category: string }[];
  options?: { label: string; color?: string | null }[];
  isRequired?: boolean;
  isHidden?: boolean;
  requiredWhen?: BoardColumn['requiredWhen'];
  defaultValue?: Record<string, unknown> | null;
  permissions?: BoardColumn['permissions'];
}

export function useColumnMutations(boardId: string) {
  const patchColumn = (board: BoardDetail, columnId: string, input: ColumnInput): BoardDetail => ({
    ...board,
    columns: board.columns.map((column) =>
      column.id === columnId
        ? {
            ...column,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.width === undefined ? {} : { width: input.width }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
            ...(input.isHidden === undefined ? {} : { isHidden: input.isHidden }),
          }
        : column,
    ),
  });
  return {
    create: useBoardMutation(
      boardId,
      (input: ColumnInput) =>
        api<{ id: string; key: string }>(`/v1/boards/${boardId}/columns`, {
          method: 'POST',
          body: input,
        }),
      { reloadItems: true },
    ),
    update: useBoardMutation(
      boardId,
      ({ columnId, input }: { columnId: string; input: ColumnInput }) =>
        api<unknown>(`/v1/boards/${boardId}/columns/${columnId}`, { method: 'PATCH', body: input }),
      { optimistic: (board, { columnId, input }) => patchColumn(board, columnId, input) },
    ),
    remove: useBoardMutation(
      boardId,
      (columnId: string) =>
        api<undefined>(`/v1/boards/${boardId}/columns/${columnId}`, { method: 'DELETE' }),
      {
        optimistic: (board, columnId) => ({
          ...board,
          columns: board.columns.filter((column) => column.id !== columnId),
        }),
        reloadItems: true,
      },
    ),
    duplicate: useBoardMutation(
      boardId,
      ({ columnId, includeValues }: { columnId: string; includeValues: boolean }) =>
        api<{ id: string; key: string }>(`/v1/boards/${boardId}/columns/${columnId}/duplicate`, {
          method: 'POST',
          body: { includeValues },
        }),
      { reloadItems: true },
    ),
    labels: useBoardMutation(
      boardId,
      ({
        columnId,
        labels,
      }: {
        columnId: string;
        labels: { id?: string; label: string; color: string; category: string }[];
      }) =>
        api<unknown>(`/v1/boards/${boardId}/columns/${columnId}/labels`, {
          method: 'PUT',
          body: { labels },
        }),
      { reloadItems: true },
    ),
    options: useBoardMutation(
      boardId,
      ({
        columnId,
        options,
      }: {
        columnId: string;
        options: { id?: string; label: string; color?: string | null }[];
      }) =>
        api<unknown>(`/v1/boards/${boardId}/columns/${columnId}/options`, {
          method: 'PUT',
          body: { options },
        }),
      { reloadItems: true },
    ),
    statusColumn: useBoardMutation(
      boardId,
      (statusColumnKey: string) =>
        api<unknown>(`/v1/boards/${boardId}/status-column`, {
          method: 'PUT',
          body: { statusColumnKey },
        }),
      {
        optimistic: (board, statusColumnKey) => ({
          ...board,
          settings: { ...board.settings, statusColumnKey },
        }),
      },
    ),
  };
}

export function useGroupMutations(boardId: string) {
  const patchGroup = (board: BoardDetail, groupId: string, patch: Partial<BoardGroup>) => ({
    ...board,
    groups: board.groups.map((group) => (group.id === groupId ? { ...group, ...patch } : group)),
  });
  return {
    create: useBoardMutation(
      boardId,
      (input: {
        name: string;
        color?: string;
        position?: { afterId?: string; beforeId?: string };
      }) => api<BoardGroup>(`/v1/boards/${boardId}/groups`, { method: 'POST', body: input }),
    ),
    update: useBoardMutation(
      boardId,
      ({
        groupId,
        input,
      }: {
        groupId: string;
        input: {
          name?: string;
          color?: string;
          isCollapsed?: boolean;
          archived?: boolean;
          position?: { afterId?: string; beforeId?: string };
        };
      }) => api<BoardGroup>(`/v1/groups/${groupId}`, { method: 'PATCH', body: input }),
      {
        optimistic: (board, { groupId, input }) =>
          input.archived === true
            ? { ...board, groups: board.groups.filter((group) => group.id !== groupId) }
            : patchGroup(board, groupId, {
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.color === undefined ? {} : { color: input.color }),
                ...(input.isCollapsed === undefined ? {} : { isCollapsed: input.isCollapsed }),
              }),
        reloadItems: true,
      },
    ),
    duplicate: useBoardMutation(
      boardId,
      ({ groupId, includeItems }: { groupId: string; includeItems: boolean }) =>
        api<BoardGroup>(`/v1/groups/${groupId}/duplicate`, {
          method: 'POST',
          body: { includeItems },
        }),
      { reloadItems: true },
    ),
    move: useBoardMutation(
      boardId,
      ({
        groupId,
        targetBoardId,
        columnMapping,
      }: {
        groupId: string;
        targetBoardId: string;
        columnMapping: Record<string, string | null>;
      }) =>
        api<BoardGroup>(`/v1/groups/${groupId}/move`, {
          method: 'POST',
          body: { boardId: targetBoardId, columnMapping },
        }),
      {
        optimistic: (board, { groupId }) => ({
          ...board,
          groups: board.groups.filter((group) => group.id !== groupId),
        }),
        reloadItems: true,
      },
    ),
    remove: useBoardMutation(
      boardId,
      (groupId: string) => api<undefined>(`/v1/groups/${groupId}`, { method: 'DELETE' }),
      {
        optimistic: (board, groupId) => ({
          ...board,
          groups: board.groups.filter((group) => group.id !== groupId),
        }),
        reloadItems: true,
      },
    ),
    restore: useBoardMutation(
      boardId,
      (groupId: string) => api<BoardGroup>(`/v1/groups/${groupId}/restore`, { method: 'POST' }),
      { reloadItems: true },
    ),
  };
}
