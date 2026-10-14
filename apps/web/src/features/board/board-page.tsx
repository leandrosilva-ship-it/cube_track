'use client';

import { Button, EmptyState, Skeleton } from '@cube-track/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Link } from '@/i18n/navigation';
import { newMutationId } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { qk } from '@/lib/query/keys';
import { rememberBoard } from '@/lib/recent-boards';
import { useBoardRealtime, useRealtimeClient } from '@/realtime/provider';

import { useBoardShortcuts, type BoardShortcut } from '../shell/shortcuts';
import { useMembers } from '../shell/hooks';
import { BoardHeader } from './board-header';
import { BoardToolbar } from './board-toolbar';
import { cellText, DISPLAYABLE_TYPES } from './cells';
import { downloadText, toCsv } from './csv';
import { useBoard, useCreateItem, useItems, useViews } from './hooks';
import { ItemsList } from './items-list';
import { activeFilterCount } from './query-builder';
import { listParams, useBoardViewState } from './store';
import { ViewTabs } from './view-tabs';

export function BoardPage({
  workspaceId,
  boardId,
  viewId,
}: {
  workspaceId: string;
  boardId: string;
  viewId: string | null;
}) {
  const t = useTranslations('board');
  const tc = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const board = useBoard(boardId);
  const views = useViews(boardId);
  const members = useMembers();
  const state = useBoardViewState(boardId);
  const params = useMemo(() => listParams(state), [state]);
  const items = useItems(board.data, params);
  const create = useCreateItem(boardId);
  const searchRef = useRef<HTMLInputElement>(null);
  const realtime = useRealtimeClient();

  const viewList = views.data?.data ?? [];
  const activeView =
    viewList.find((view) => view.id === viewId) ??
    viewList.find((view) => view.isDefault) ??
    viewList[0];
  useBoardRealtime(boardId, board.data?.seq, activeView?.id ?? null);

  useEffect(() => {
    if (realtime !== null && activeView !== undefined)
      realtime.setPresenceState(boardId, { viewId: activeView.id });
  }, [realtime, boardId, activeView]);

  useEffect(() => {
    if (board.data !== undefined)
      rememberBoard({
        id: board.data.id,
        name: board.data.name,
        workspaceId: board.data.workspaceId,
      });
  }, [board.data]);

  useEffect(() => {
    if (board.data !== undefined) document.title = `${board.data.name} · CUBE TRACK`;
  }, [board.data]);

  const allItems = useMemo(
    () => (items.data?.pages ?? []).flatMap((page) => page.data),
    [items.data],
  );
  const memberMap = useMemo(
    () => new Map((members.data ?? []).map((member) => [member.userId, member])),
    [members.data],
  );

  const newItem = useCallback(() => {
    const group = board.data?.groups[0];
    if (group === undefined || board.data?.permissions.includes('item.create') !== true) return;
    create.mutate({
      groupId: group.id,
      name: t('items.newItemName'),
      mutationId: newMutationId(),
      tempId: `temp-${newMutationId()}`,
    });
  }, [board.data, create, t]);

  const onShortcut = useCallback(
    (shortcut: BoardShortcut) => {
      if (shortcut === 'newItem') newItem();
      else searchRef.current?.focus();
    },
    [newItem],
  );
  useBoardShortcuts(onShortcut);

  if (board.isError) {
    const forbidden = isApiError(board.error, 403) || isApiError(board.error, 404);
    return (
      <div className="p-6">
        <EmptyState
          icon={<ShieldAlert aria-hidden="true" />}
          title={forbidden ? tc('pageNotFound') : tc('unavailable')}
          description={tc('pageNotFoundDescription')}
          action={
            <Button asChild>
              <Link href="/">{tc('goHome')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (board.data === undefined) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  const detail = board.data;

  const exportCsv = () => {
    const columns = detail.columns.filter(
      (column) =>
        DISPLAYABLE_TYPES.has(column.type) && !state.hiddenColumnKeys.includes(column.key),
    );
    const header = [t('items.name'), ...columns.map((column) => column.title)];
    const rows = allItems.map((item) => [
      item.name,
      ...columns.map((column) => cellText(item, column, memberMap, locale)),
    ]);
    downloadText(`${detail.name}.csv`, toCsv(header, rows, locale));
  };

  return (
    <div className="flex min-h-full flex-col">
      <BoardHeader board={detail} />
      <ViewTabs
        workspaceId={workspaceId}
        boardId={boardId}
        views={viewList}
        activeViewId={activeView?.id ?? null}
        canManage={views.data?.canManage ?? false}
      />
      <BoardToolbar
        board={detail}
        onNewItem={newItem}
        onExport={exportCsv}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: qk.board(boardId) });
        }}
        searchRef={searchRef}
        creating={create.isPending}
      />
      <ItemsList
        board={detail}
        items={allItems}
        loading={items.isPending}
        state={state}
        members={memberMap}
        hasNextPage={items.hasNextPage}
        fetchingNext={items.isFetchingNextPage}
        onLoadMore={() => {
          void items.fetchNextPage();
        }}
        filtered={activeFilterCount(params) > 0}
      />
    </div>
  );
}
