'use client';

import { formatRelativeTime } from '@cube-track/i18n';
import { Avatar, Button, EmptyState, Skeleton, Switch, cn } from '@cube-track/ui';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Inbox } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api/client';
import type { Notification, NotificationPage } from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

import { useTree } from '../workspace/hooks';
import { useCurrentWorkspaceId } from '../workspace/use-current-workspace';

export function InboxPage() {
  const t = useTranslations('inbox');
  const tc = useTranslations('common');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const workspaceId = useCurrentWorkspaceId();
  const tree = useTree(workspaceId);
  const notifications = useInfiniteQuery({
    queryKey: qk.notificationList(unreadOnly),
    initialPageParam: null as string | null,
    getNextPageParam: (page: NotificationPage) => page.pageInfo.nextCursor,
    queryFn: ({ pageParam }) =>
      api<NotificationPage>('/v1/me/notifications', {
        query: { limit: 30, cursor: pageParam, unreadOnly: unreadOnly ? 'true' : undefined },
      }),
  });
  const markRead = useMutation({
    mutationFn: (ids: string[] | undefined) =>
      api('/v1/me/notifications/read', { method: 'POST', body: ids === undefined ? {} : { ids } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.notifications() }),
  });
  const items: Notification[] = (notifications.data?.pages ?? []).flatMap((page) => page.data);
  const unread = notifications.data?.pages[0]?.unreadCount ?? 0;
  const workspaceOf = (boardId: string | null) =>
    boardId === null
      ? null
      : (tree.data?.boards.find((board) => board.id === boardId)?.workspaceId ?? workspaceId);

  return (
    <div className="pb-10">
      <PageHeader
        title={t('title')}
        subtitle={t('unread', { count: unread })}
        actions={
          <>
            <div className="flex items-center gap-2 text-sm">
              <Switch id="unread-only" checked={unreadOnly} onCheckedChange={setUnreadOnly} />
              <label htmlFor="unread-only">{t('unreadOnly')}</label>
            </div>
            <Button
              variant="secondary"
              disabled={unread === 0}
              loading={markRead.isPending}
              onClick={() => {
                markRead.mutate(undefined);
              }}
            >
              <CheckCheck aria-hidden="true" />
              {t('markAllRead')}
            </Button>
          </>
        }
      />
      <div className="px-4 sm:px-8">
        {notifications.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Inbox aria-hidden="true" />} title={t('empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {items.map((notification) => {
              const workspace = workspaceOf(notification.boardId);
              const href =
                notification.boardId !== null && workspace !== null
                  ? `/w/${workspace}/b/${notification.boardId}`
                  : null;
              const content = (
                <>
                  <Avatar
                    person={{
                      id: notification.actorId ?? notification.id,
                      name: notification.actorName ?? 'CUBE TRACK',
                      avatarUrl: notification.actorAvatarUrl,
                    }}
                    size="md"
                    decorative
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block text-sm',
                        notification.readAt === null && 'font-semibold',
                      )}
                    >
                      {notification.title}
                    </span>
                    {notification.body === null ? null : (
                      <span className="line-clamp-2 block text-sm text-fg-muted">
                        {notification.body}
                      </span>
                    )}
                    <span className="block text-xs text-fg-subtle">
                      {formatRelativeTime(notification.createdAt, locale)}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={notification.id} className="flex items-start gap-3 p-3">
                  {href === null ? (
                    <div className="flex min-w-0 flex-1 items-start gap-3">{content}</div>
                  ) : (
                    <Link
                      href={href}
                      className="flex min-w-0 flex-1 items-start gap-3 rounded-md"
                      onClick={() => {
                        if (notification.readAt === null) markRead.mutate([notification.id]);
                      }}
                    >
                      {content}
                    </Link>
                  )}
                  {notification.readAt === null ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        markRead.mutate([notification.id]);
                      }}
                    >
                      {t('markRead')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {notifications.hasNextPage ? (
          <div className="mt-4 flex justify-center">
            <Button
              variant="secondary"
              loading={notifications.isFetchingNextPage}
              onClick={() => void notifications.fetchNextPage()}
            >
              {tc('loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
