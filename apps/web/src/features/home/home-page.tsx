'use client';

import { Button, EmptyState, Skeleton } from '@cube-track/ui';
import { Clock, LayoutGrid, Plus, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Link } from '@/i18n/navigation';
import { readRecentBoards, type RecentBoard } from '@/lib/recent-boards';
import { openDialog } from '@/stores/shell';
import { useSession } from '@/stores/session';

import { useFavorites, useTree, useWorkspaces } from '../workspace/hooks';
import { useCurrentWorkspaceId } from '../workspace/use-current-workspace';

function BoardCard({ href, name }: { href: string; name: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-sm font-medium hover:border-primary hover:bg-surface-hover"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
        <LayoutGrid className="size-4" aria-hidden="true" />
      </span>
      <span className="truncate">{name}</span>
    </Link>
  );
}

export function HomePage() {
  const t = useTranslations('home');
  const user = useSession((state) => state.user);
  const tenant = useSession((state) => state.tenant);
  const favorites = useFavorites();
  const workspaces = useWorkspaces();
  const workspaceId = useCurrentWorkspaceId();
  const tree = useTree(workspaceId);
  // O shell só monta páginas no cliente (após recuperar a sessão): leitura direta do armazenamento.
  const [recent] = useState<RecentBoard[]>(readRecentBoards);
  const boardFavorites = (favorites.data ?? []).filter((entry) => entry.entityType === 'board');

  return (
    <div className="pb-10">
      <PageHeader
        title={t('greeting', { name: user?.name.split(' ')[0] ?? '' })}
        subtitle={t('subtitle', { organization: tenant?.name ?? '' })}
        {...(tree.data?.canCreateBoards === true && workspaceId !== null
          ? {
              actions: (
                <Button
                  onClick={() => {
                    openDialog({ type: 'newBoard', workspaceId, folderId: null });
                  }}
                >
                  <Plus aria-hidden="true" />
                  {t('quickStart')}
                </Button>
              ),
            }
          : {})}
      />
      <div className="grid gap-8 px-4 sm:px-8 lg:grid-cols-2">
        <section aria-labelledby="home-recent">
          <h2 id="home-recent" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Clock className="size-4 text-fg-muted" aria-hidden="true" />
            {t('recent')}
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noRecent')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {recent.map((board) => (
                <BoardCard
                  key={board.id}
                  href={`/w/${board.workspaceId}/b/${board.id}`}
                  name={board.name}
                />
              ))}
            </div>
          )}
        </section>
        <section aria-labelledby="home-favorites">
          <h2 id="home-favorites" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Star className="size-4 text-fg-muted" aria-hidden="true" />
            {t('favorites')}
          </h2>
          {favorites.data === undefined ? (
            <Skeleton className="h-14" />
          ) : boardFavorites.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noFavorites')}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {boardFavorites.map((favorite) => (
                <BoardCard
                  key={favorite.entityId}
                  href={`/w/${favorite.workspaceId}/b/${favorite.entityId}`}
                  name={favorite.name}
                />
              ))}
            </div>
          )}
        </section>
        <section aria-labelledby="home-workspaces" className="lg:col-span-2">
          <h2 id="home-workspaces" className="mb-3 text-base font-semibold">
            {t('workspaces')}
          </h2>
          {workspaces.data === undefined ? (
            <Skeleton className="h-20" />
          ) : workspaces.data.length === 0 ? (
            <EmptyState title={t('workspaces')} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {workspaces.data.map((workspace) => (
                <Link
                  key={workspace.id}
                  href={`/w/${workspace.id}`}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 hover:border-primary hover:bg-surface-hover"
                >
                  <span className="font-semibold">{workspace.name}</span>
                  {workspace.description === null ? null : (
                    <span className="line-clamp-2 text-sm text-fg-muted">
                      {workspace.description}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
