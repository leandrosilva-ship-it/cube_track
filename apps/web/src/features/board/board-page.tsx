'use client';

import { Button, EmptyState, Skeleton } from '@cube-track/ui';
import { ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { rememberBoard } from '@/lib/recent-boards';
import { useBoardRealtime, useRealtimeClient } from '@/realtime/provider';

import { TableView } from '../table/table-view';
import { BoardHeader } from './board-header';
import { useBoard, useViews } from './hooks';
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
  const board = useBoard(boardId);
  const views = useViews(boardId);
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

  // Board e views juntos: abas e barra entram de uma vez, sem deslocar a lista (CLS).
  if (board.data === undefined || views.isPending) {
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BoardHeader board={detail} />
      <ViewTabs
        workspaceId={workspaceId}
        boardId={boardId}
        views={viewList}
        activeViewId={activeView?.id ?? null}
        canManage={views.data?.canManage ?? false}
      />
      <TableView key={boardId} board={detail} searchRef={searchRef} />
    </div>
  );
}
