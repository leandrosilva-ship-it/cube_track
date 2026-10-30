'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Skeleton,
} from '@cube-track/ui';
import {
  Check,
  ChevronsUpDown,
  FolderPlus,
  LayoutGrid,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Star,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import { openDialog } from '@/stores/shell';
import { updatePreferences } from '@/stores/preferences';

import { useFavorites, useTree, useWorkspaces } from './hooks';
import { useCurrentWorkspaceId } from './use-current-workspace';
import { WorkspaceTree } from './workspace-tree';

export interface WorkspacePanelProps {
  /** Chamado ao navegar (fecha o drawer no mobile). */
  onNavigate?: () => void;
  /** Exibe o botão de recolher (desktop). */
  collapsible?: boolean;
}

/** Painel lateral: seletor de workspace, filtro, favoritos e árvore de pastas/boards. */
export function WorkspacePanel({ onNavigate, collapsible = false }: WorkspacePanelProps) {
  const t = useTranslations('shell.workspace');
  const router = useRouter();
  const workspaces = useWorkspaces();
  const workspaceId = useCurrentWorkspaceId();
  const tree = useTree(workspaceId);
  const favorites = useFavorites();
  const [filter, setFilter] = useState('');
  const current = workspaces.data?.find((workspace) => workspace.id === workspaceId);
  const boardFavorites = (favorites.data ?? []).filter((entry) => entry.entityType === 'board');

  return (
    <nav aria-label={t('panel')} className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="min-w-0 flex-1 justify-between px-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground before:content-[attr(data-initial)]"
                  data-initial={(current?.name ?? '·').slice(0, 1).toUpperCase()}
                  aria-hidden="true"
                />
                <span className="truncate font-semibold">
                  <span className="sr-only">{t('select')}: </span>
                  {current?.name ?? '…'}
                </span>
              </span>
              <ChevronsUpDown className="text-fg-muted" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuLabel>{t('select')}</DropdownMenuLabel>
            {(workspaces.data ?? []).map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                icon={
                  workspace.id === workspaceId ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <span className="size-4" />
                  )
                }
                onSelect={() => {
                  updatePreferences({ lastWorkspaceId: workspace.id });
                  router.push(`/w/${workspace.id}`);
                  onNavigate?.();
                }}
              >
                {workspace.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<Plus aria-hidden="true" />}
              onSelect={() => {
                openDialog({ type: 'newWorkspace' });
              }}
            >
              {t('new')}
            </DropdownMenuItem>
            {tree.data?.canManageWorkspace === true && workspaceId !== null ? (
              <DropdownMenuItem asChild>
                <Link href={`/w/${workspaceId}/settings`} onClick={onNavigate}>
                  <Settings className="size-4" aria-hidden="true" />
                  {t('settings')}
                </Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {collapsible ? (
          <IconButton
            label={t('hidePanel')}
            icon={<PanelLeftClose aria-hidden="true" />}
            size="icon-sm"
            shortcut="["
            onClick={() => {
              updatePreferences({ panelCollapsed: true });
            }}
          />
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <Input
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            placeholder={t('filter')}
            aria-label={t('filter')}
            className="h-8 ps-8"
          />
        </div>
        {tree.data === undefined ||
        (!tree.data.canCreateBoards && !tree.data.canManageFolders) ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t('newBoard')}
                icon={<Plus aria-hidden="true" />}
                variant="primary"
                size="icon-sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {tree.data.canCreateBoards && workspaceId !== null ? (
                <DropdownMenuItem
                  icon={<LayoutGrid aria-hidden="true" />}
                  onSelect={() => {
                    openDialog({ type: 'newBoard', workspaceId, folderId: null });
                  }}
                >
                  {t('newBoard')}
                </DropdownMenuItem>
              ) : null}
              {tree.data.canManageFolders && workspaceId !== null ? (
                <DropdownMenuItem
                  icon={<FolderPlus aria-hidden="true" />}
                  onSelect={() => {
                    openDialog({ type: 'newFolder', workspaceId, parentId: null });
                  }}
                >
                  {t('newFolder')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {boardFavorites.length > 0 ? (
          <section className="mb-3" aria-labelledby="panel-favorites">
            <h2
              id="panel-favorites"
              className="mb-1 flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
            >
              <Star className="size-3" aria-hidden="true" />
              {t('favorites')}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {boardFavorites.map((favorite) => (
                <li key={favorite.entityId}>
                  <Link
                    href={`/w/${favorite.workspaceId}/b/${favorite.entityId}`}
                    onClick={onNavigate}
                    className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"
                  >
                    <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{favorite.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-labelledby="panel-boards">
          <h2
            id="panel-boards"
            className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
          >
            {t('boards')}
          </h2>
          {tree.data === undefined ? (
            <div className="flex flex-col gap-1.5 px-2" aria-busy="true">
              <Skeleton className="h-6" />
              <Skeleton className="h-6 w-5/6" />
              <Skeleton className="h-6 w-4/6" />
            </div>
          ) : (
            <WorkspaceTree
              key={tree.data.workspaceId}
              tree={tree.data}
              favorites={favorites.data ?? []}
              filter={filter}
              {...(onNavigate === undefined ? {} : { onNavigate })}
            />
          )}
        </section>
      </div>
    </nav>
  );
}
