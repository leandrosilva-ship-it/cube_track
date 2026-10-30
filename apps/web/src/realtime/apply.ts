import type { RealtimeEvent } from '@cube-track/shared';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { BoardDetail, Item, Page, WorkspaceTree } from '@/lib/api/types';
import { isFiltered, qk, type ItemListParams } from '@/lib/query/keys';
import { sessionStore } from '@/stores/session';

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
  descriptionText: 'descriptionText',
  isMilestone: 'isMilestone',
  scheduleMode: 'scheduleMode',
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

/** Ajusta um contador do indicador da linha (ex.: `updates`, `attachments`, `unreadUpdates`). */
function bumpIndicator(
  queryClient: QueryClient,
  boardId: string,
  itemId: string,
  field: 'updates' | 'attachments' | 'unreadUpdates',
  delta: number,
): void {
  patchItem(queryClient, boardId, itemId, (item) =>
    item.indicators === undefined
      ? item
      : { ...item, indicators: { ...item.indicators, [field]: Math.max(0, item.indicators[field] + delta) } },
  );
}

/** Invalida consultas do painel do item cuja chave é `['items', itemId, feature, ...]`. */
function invalidateItemFeature(queryClient: QueryClient, itemId: string, feature: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'items' && query.queryKey[1] === itemId && query.queryKey[2] === feature,
  });
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
    phaseId: (snapshot.phaseId as string | null | undefined) ?? null,
    phaseEnteredAt: (snapshot.phaseEnteredAt as string | null | undefined) ?? null,
    values: (snapshot.values as Record<string, unknown> | undefined) ?? {},
    fieldVersions: {},
    version: Number(snapshot.version ?? 1),
    descriptionText: (snapshot.descriptionText as string | null | undefined) ?? null,
    plannedStartDate: (snapshot.plannedStartDate as string | null | undefined) ?? null,
    plannedEndDate: (snapshot.plannedEndDate as string | null | undefined) ?? null,
    replannedStartDate: (snapshot.replannedStartDate as string | null | undefined) ?? null,
    replannedEndDate: (snapshot.replannedEndDate as string | null | undefined) ?? null,
    actualStartDate: (snapshot.actualStartDate as string | null | undefined) ?? null,
    actualEndDate: (snapshot.actualEndDate as string | null | undefined) ?? null,
    progress: (snapshot.progress as string | null | undefined) ?? null,
    isMilestone: (snapshot.isMilestone as boolean | undefined) ?? false,
    scheduleMode: (snapshot.scheduleMode as 'auto' | 'manual' | undefined) ?? 'auto',
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
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
      if (context.isOwnPendingMutation(event.clientMutationId)) return;
      const { item } = event.payload as { item: Record<string, unknown> };
      const created = snapshotToItem(item);
      if (findCachedItem(queryClient, boardId, created.id) !== undefined) return;
      insertItem(queryClient, boardId, created);
      if (created.parentItemId !== null)
        bumpSubitemCount(queryClient, boardId, created.parentItemId, 1);
      return;
    }
    case 'item.updated': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
      if (context.isOwnPendingMutation(event.clientMutationId)) return;
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
      queryClient.setQueryData<Item>(qk.item(payload.itemId), (item) =>
        item === undefined ? item : applyItemChanges(item, payload.changes, payload.version),
      );
      // Destaque visual nas células alteradas por outra pessoa (Gherkin do Prompt 5).
      markRemoteChanges(payload.itemId, applied);
      if (payload.changes.some((change) => change.field === 'dependencies'))
        void queryClient.invalidateQueries({ queryKey: qk.dependencies(boardId) });
      if (payload.changes.some((change) => change.field === 'name' || change.field === 'dependencies'))
        invalidateItemFeature(queryClient, payload.itemId, 'activity');
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
      void queryClient.invalidateQueries({ queryKey: qk.item(itemId) });
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
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
    case 'update.created': {
      const { itemId, authorId } = event.payload as { itemId: string; authorId: string | null };
      if (boardId !== null) {
        bumpIndicator(queryClient, boardId, itemId, 'updates', 1);
        if (authorId !== (sessionStore.getState().user?.id ?? null))
          bumpIndicator(queryClient, boardId, itemId, 'unreadUpdates', 1);
      }
      invalidateItemFeature(queryClient, itemId, 'updates');
      return;
    }
    case 'update.changed': {
      const { itemId } = event.payload as { itemId: string };
      invalidateItemFeature(queryClient, itemId, 'updates');
      return;
    }
    case 'reply.created':
    case 'reply.changed': {
      const { itemId, updateId } = event.payload as { itemId: string; updateId: string };
      invalidateItemFeature(queryClient, itemId, 'updates');
      void queryClient.invalidateQueries({ queryKey: qk.replies(updateId) });
      return;
    }
    case 'reaction.changed': {
      const { itemId, targetType } = event.payload as { itemId: string; targetType: 'update' | 'reply' };
      invalidateItemFeature(queryClient, itemId, 'updates');
      if (targetType === 'reply')
        void queryClient.invalidateQueries({
          predicate: (query) => query.queryKey[0] === 'updates' && query.queryKey[2] === 'replies',
        });
      return;
    }
    case 'attachment.changed': {
      const { itemId, change } = event.payload as { itemId: string; change: 'uploaded' | 'deleted' };
      if (boardId !== null) bumpIndicator(queryClient, boardId, itemId, 'attachments', change === 'uploaded' ? 1 : -1);
      invalidateItemFeature(queryClient, itemId, 'files');
      invalidateItemFeature(queryClient, itemId, 'activity');
      return;
    }
    case 'checklist.changed': {
      const { itemId } = event.payload as { itemId: string };
      invalidateItemFeature(queryClient, itemId, 'checklists');
      invalidateItemFeature(queryClient, itemId, 'activity');
      return;
    }
    case 'milestone.changed': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.milestones(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.gantt(boardId) });
      return;
    }
    case 'baseline.changed': {
      if (boardId === null) return;
      const { baselineId } = event.payload as { baselineId: string };
      void queryClient.invalidateQueries({ queryKey: qk.baselines(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.baseline(baselineId) });
      return;
    }
    case 'automation.changed': {
      // Automação de workspace inteiro (boardId nulo) não tem UI de gestão nesta entrega.
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.automations(boardId) });
      return;
    }
    case 'webhook.changed': {
      // Webhook de workspace inteiro (boardId nulo) não tem UI de gestão nesta entrega.
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.webhooksOfBoard(boardId) });
      return;
    }
    case 'phase.changed': {
      const { boardId: eventBoardId } = event.payload as { boardId: string };
      void queryClient.invalidateQueries({ queryKey: qk.processConfig(eventBoardId) });
      return;
    }
    case 'process_config.changed': {
      const { boardId: eventBoardId } = event.payload as { boardId: string };
      void queryClient.invalidateQueries({ queryKey: qk.processConfig(eventBoardId) });
      void queryClient.invalidateQueries({ queryKey: qk.slas(eventBoardId) });
      return;
    }
    case 'sla.changed': {
      const { boardId: eventBoardId } = event.payload as { boardId: string };
      void queryClient.invalidateQueries({ queryKey: qk.slaTrackers(eventBoardId) });
      void queryClient.invalidateQueries({ queryKey: qk.slas(eventBoardId) });
      return;
    }
    case 'approval.changed': {
      const { itemId } = event.payload as { itemId: string };
      invalidateItemFeature(queryClient, itemId, 'approvals');
      invalidateItemFeature(queryClient, itemId, 'activity');
      return;
    }
    case 'dashboard.changed': {
      const { dashboardId } = event.payload as { dashboardId: string };
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(dashboardId) });
      // A lista de dashboards do workspace ('workspaces', id, 'dashboards') não traz o workspaceId
      // no payload: casa por conter 'dashboards' na chave em vez de reconstruir a chave exata.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes('dashboards'),
      });
      return;
    }
    case 'widget.changed': {
      const { dashboardId } = event.payload as { dashboardId: string };
      void queryClient.invalidateQueries({ queryKey: qk.dashboardWidgets(dashboardId) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboardData(dashboardId) });
      return;
    }
    case 'time_entry.changed': {
      const { itemId, userId: entryUserId } = event.payload as { itemId: string; userId: string };
      void queryClient.invalidateQueries({ queryKey: qk.timeEntriesOfItem(itemId) });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'users' && query.queryKey[1] === entryUserId && query.queryKey[2] === 'time-entries',
      });
      return;
    }
    case 'timesheet_approval.changed': {
      const { userId: approvalUserId } = event.payload as { userId: string };
      void queryClient.invalidateQueries({ queryKey: qk.timesheetApprovalsOfUser(approvalUserId) });
      void queryClient.invalidateQueries({ queryKey: qk.timesheetApprovalsPending() });
      return;
    }
    case 'project_health.reported': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.projectHealth(boardId) });
      // Um widget `project_health` de qualquer dashboard pode mostrar este board: sem o
      // dashboardId no payload, invalida toda `dashboardData` em cache (mesmo padrão já usado
      // para a lista de dashboards em `dashboard.changed`).
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes('data') && query.queryKey.includes('dashboards'),
      });
      return;
    }
    case 'allocation.changed': {
      // Capacidade agrega alocações de vários boards e não traz boardId/userId fixos no payload de
      // toda consulta (ex.: heatmap de workspace): invalida por prefixo, mesmo padrão de `dashboard.changed`.
      const { boardId: eventBoardId, userId } = event.payload as {
        boardId: string;
        userId: string;
        itemId: string | null;
        change: 'created' | 'updated' | 'deleted';
      };
      void queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === 'boards' && query.queryKey[1] === eventBoardId && query.queryKey[2] === 'allocations') ||
          (query.queryKey[0] === 'users' && query.queryKey[1] === userId && query.queryKey[2] === 'allocations') ||
          query.queryKey[0] === 'capacity',
      });
      return;
    }
    case 'absence.changed': {
      // Sem board (evento de workspace/tenant): chega mesmo sem "assinar" nada específico.
      const { userId } = event.payload as { absenceId: string; userId: string; change: string };
      void queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === 'users' && query.queryKey[1] === userId && query.queryKey[2] === 'absences') ||
          (query.queryKey[0] === 'absences' && query.queryKey[1] === 'pending') ||
          query.queryKey[0] === 'capacity',
      });
      return;
    }
    case 'resource_request.changed': {
      const { boardId: eventBoardId } = event.payload as {
        requestId: string;
        boardId: string;
        change: 'created' | 'updated' | 'fulfilled' | 'cancelled';
      };
      void queryClient.invalidateQueries({
        predicate: (query) =>
          (query.queryKey[0] === 'boards' && query.queryKey[1] === eventBoardId && query.queryKey[2] === 'resource-requests') ||
          (query.queryKey[0] === 'resource-requests' && query.queryKey[1] === 'open'),
      });
      return;
    }
    case 'portfolio.changed': {
      const { portfolioId, workspaceId } = event.payload as {
        portfolioId: string;
        workspaceId: string;
        change: 'created' | 'updated' | 'deleted';
      };
      void queryClient.invalidateQueries({ queryKey: qk.portfoliosOf(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.portfolio(portfolioId) });
      void queryClient.invalidateQueries({ queryKey: qk.portfolioRollup(portfolioId) });
      return;
    }
    case 'program.changed': {
      const { programId, workspaceId } = event.payload as {
        programId: string;
        workspaceId: string;
        portfolioId: string | null;
        change: 'created' | 'updated' | 'deleted';
      };
      void queryClient.invalidateQueries({ queryKey: qk.programsOf(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.program(programId) });
      void queryClient.invalidateQueries({ queryKey: qk.programRollup(programId) });
      return;
    }
    case 'score.changed': {
      const { scoringModelId } = event.payload as {
        scoreId: string;
        scoringModelId: string;
        boardId: string;
      };
      void queryClient.invalidateQueries({ queryKey: qk.scoringRanking(scoringModelId) });
      void queryClient.invalidateQueries({ queryKey: qk.scoringValueEffort(scoringModelId) });
      return;
    }
    case 'stage_gate.changed': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.stageGatesOfBoard(boardId) });
      return;
    }
    case 'risk.changed': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.risksOfBoard(boardId) });
      return;
    }
    case 'issue.changed': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.issuesOfBoard(boardId) });
      return;
    }
    case 'budget.changed': {
      const { boardId: eventBoardId } = event.payload as {
        budgetId: string;
        boardId: string | null;
        programId: string | null;
        portfolioId: string | null;
        change: 'created' | 'updated' | 'deleted';
      };
      if (eventBoardId !== null) void queryClient.invalidateQueries({ queryKey: qk.budgetsOfBoard(eventBoardId) });
      return;
    }
    case 'cost_entry.changed': {
      const { budgetId } = event.payload as { costEntryId: string; budgetId: string; boardId: string | null };
      void queryClient.invalidateQueries({ queryKey: qk.costEntriesOfBudget(budgetId) });
      return;
    }
    case 'project_health.changed': {
      if (boardId === null) return;
      void queryClient.invalidateQueries({ queryKey: qk.projectHealth(boardId) });
      void queryClient.invalidateQueries({ queryKey: qk.boardStatusReport(boardId) });
      // RAG/EVM automático (ADR 0053): o evento não traz portfolioId/programId (o board recalculado
      // pode pertencer a qualquer um) — invalida rollups/relatórios de portfólio e programa por
      // substring, mesmo padrão de `dashboard.changed`/`allocation.changed` acima.
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.includes('rollup') ||
          query.queryKey.includes('status-report') ||
          (query.queryKey.includes('data') && query.queryKey.includes('dashboards')),
      });
      return;
    }
    case 'health_rule_set.changed': {
      const { boardId: eventBoardId } = event.payload as { ruleSetId: string; boardId: string | null };
      if (eventBoardId === null) {
        void queryClient.invalidateQueries({ queryKey: qk.healthRulesDefault() });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: qk.healthRulesOfBoard(eventBoardId) });
      return;
    }
    case 'contract.changed': {
      const { contractId, workspaceId } = event.payload as {
        contractId: string;
        workspaceId: string;
        change: 'created' | 'updated' | 'deleted';
      };
      void queryClient.invalidateQueries({ queryKey: qk.contractsOf(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.contract(contractId) });
      // Os widgets de UST (ust_balance/ust_by_dimension/ust_forecast) referenciam o contrato mas o
      // evento não traz o dashboardId — mesmo padrão de `project_health.changed` acima.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes('data') && query.queryKey.includes('dashboards'),
      });
      return;
    }
    case 'service_catalog_item.changed': {
      const { contractId } = event.payload as { catalogItemId: string; contractId: string; change: string };
      void queryClient.invalidateQueries({ queryKey: qk.catalogOf(contractId) });
      return;
    }
    case 'service_order.changed': {
      const { contractId, boardId: orderBoardId, itemId } = event.payload as {
        serviceOrderId: string;
        contractId: string;
        boardId: string | null;
        itemId: string | null;
        change: 'created' | 'updated' | 'deleted';
      };
      void queryClient.invalidateQueries({ queryKey: qk.contract(contractId) });
      if (orderBoardId !== null) void queryClient.invalidateQueries({ queryKey: qk.serviceOrdersOfBoard(orderBoardId) });
      if (itemId !== null) void queryClient.invalidateQueries({ queryKey: qk.serviceOrderOfItem(itemId) });
      // O saldo na tela de Contratos vem da LISTA (`qk.contractsOf`, ContractsPage encontra o
      // contrato selecionado nela — não existe tela que consuma `qk.contract` isoladamente), e o
      // evento não carrega `workspaceId` para montar essa chave: invalida por predicado qualquer
      // lista de contratos de workspace já em cache. É o que faz "saldo atualizado automaticamente
      // a cada OS aceita" valer também em tempo real entre dois navegadores, não só na mesma aba.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'workspaces' && query.queryKey[2] === 'contracts',
      });
      return;
    }
    case 'measurement.changed': {
      const { contractId } = event.payload as { measurementId: string; contractId: string; change: string };
      void queryClient.invalidateQueries({ queryKey: qk.measurementsOf(contractId) });
      return;
    }
    case 'invoice.changed': {
      const { contractId } = event.payload as { invoiceId: string; contractId: string; change: string };
      void queryClient.invalidateQueries({ queryKey: qk.invoicesOf(contractId) });
      return;
    }
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
