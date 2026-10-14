'use client';

import { EmptyState, IconButton, Skeleton } from '@cube-track/ui';
import { Folder, LayoutGrid, Layers, Star, StarOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/common/page-header';
import { Link } from '@/i18n/navigation';
import type { Favorite } from '@/lib/api/types';

import { useFavorites, useToggleFavorite } from '../workspace/hooks';

const ICONS = { board: LayoutGrid, folder: Folder, workspace: Layers } as const;

function hrefOf(favorite: Favorite): string {
  if (favorite.entityType === 'board') return `/w/${favorite.workspaceId}/b/${favorite.entityId}`;
  return `/w/${favorite.workspaceId}`;
}

export function FavoritesPage() {
  const t = useTranslations('favorites');
  const tw = useTranslations('shell.workspace');
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  return (
    <div className="pb-10">
      <PageHeader title={t('title')} />
      <div className="px-4 sm:px-8">
        {favorites.data === undefined ? (
          <Skeleton className="h-24" />
        ) : favorites.data.length === 0 ? (
          <EmptyState icon={<Star aria-hidden="true" />} title={t('empty')} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {favorites.data.map((favorite) => {
              const Icon = ICONS[favorite.entityType];
              return (
                <li
                  key={favorite.entityId}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2"
                >
                  <Link
                    href={hrefOf(favorite)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 hover:underline"
                  >
                    <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{favorite.name}</span>
                      <span className="block text-xs text-fg-muted">
                        {t(`types.${favorite.entityType}`)}
                      </span>
                    </span>
                  </Link>
                  <IconButton
                    label={tw('removeFavorite')}
                    icon={<StarOff aria-hidden="true" />}
                    size="icon-sm"
                    onClick={() => {
                      toggle.mutate({ ...favorite, favorite: false });
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
