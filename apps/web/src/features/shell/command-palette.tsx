'use client';

import { CommandDialog, CommandGroup, CommandItem } from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  CalendarDays,
  FolderPlus,
  Home,
  Keyboard,
  LayoutGrid,
  LogOut,
  Moon,
  Rows3,
  Search,
  Settings,
  Sparkles,
  Star,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api/client';
import type { SearchHit } from '@/lib/api/types';
import { signOut } from '@/lib/auth/session';
import { qk } from '@/lib/query/keys';
import { openDialog, setPaletteOpen, useShell } from '@/stores/shell';
import { preferencesStore, resolvedTheme, updatePreferences } from '@/stores/preferences';

import { useFavorites, useTree } from '../workspace/hooks';
import { useCurrentWorkspaceId } from '../workspace/use-current-workspace';
import { readRecentBoards } from '@/lib/recent-boards';

/** Paleta de comandos (Ctrl/⌘+K): páginas, boards (locais + busca no servidor) e ações. */
export function CommandPalette() {
  const t = useTranslations('palette');
  const tn = useTranslations('shell.nav');
  const open = useShell((state) => state.paletteOpen);
  const router = useRouter();
  const workspaceId = useCurrentWorkspaceId();
  const tree = useTree(workspaceId);
  const favorites = useFavorites();
  const [search, setSearch] = useState('');
  const query = search.trim();
  const remote = useQuery({
    queryKey: qk.search(`palette:${query}`),
    queryFn: () =>
      api<{ data: SearchHit[] }>('/v1/search', {
        query: { q: query, types: 'boards', limit: 8 },
      }).then((response) => response.data),
    enabled: open && query.length >= 2,
    staleTime: 30_000,
  });

  const close = () => {
    setPaletteOpen(false);
    setSearch('');
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  const boards = new Map<string, { id: string; name: string; workspaceId: string }>();
  for (const recent of readRecentBoards()) boards.set(recent.id, recent);
  for (const favorite of favorites.data ?? []) {
    if (favorite.entityType === 'board')
      boards.set(favorite.entityId, {
        id: favorite.entityId,
        name: favorite.name,
        workspaceId: favorite.workspaceId,
      });
  }
  for (const board of tree.data?.boards ?? [])
    boards.set(board.id, { id: board.id, name: board.name, workspaceId: board.workspaceId });
  for (const hit of remote.data ?? []) {
    if (!boards.has(hit.boardId) && workspaceId !== null)
      boards.set(hit.boardId, { id: hit.boardId, name: hit.title, workspaceId });
  }

  const pages = [
    { href: '/', label: tn('home'), icon: <Home aria-hidden="true" /> },
    { href: '/my-week', label: tn('myWeek'), icon: <CalendarDays aria-hidden="true" /> },
    { href: '/inbox', label: tn('inbox'), icon: <Bell aria-hidden="true" /> },
    { href: '/favorites', label: tn('favorites'), icon: <Star aria-hidden="true" /> },
    { href: '/search', label: tn('search'), icon: <Search aria-hidden="true" /> },
    { href: '/ai', label: tn('ai'), icon: <Sparkles aria-hidden="true" /> },
    { href: '/settings', label: tn('settings'), icon: <Settings aria-hidden="true" /> },
  ];

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (next) setPaletteOpen(true);
        else close();
      }}
      title={t('title')}
      placeholder={t('placeholder')}
      emptyText={t('empty')}
      search={search}
      onSearchChange={setSearch}
    >
      <CommandGroup heading={t('boards')}>
        {[...boards.values()].slice(0, 30).map((board) => (
          <CommandItem
            key={board.id}
            value={`board ${board.name} ${board.id}`}
            icon={<LayoutGrid aria-hidden="true" />}
            onSelect={() => {
              go(`/w/${board.workspaceId}/b/${board.id}`);
            }}
          >
            {board.name}
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandGroup heading={t('navigation')}>
        {pages.map((page) => (
          <CommandItem
            key={page.href}
            value={`page ${page.label}`}
            icon={page.icon}
            onSelect={() => {
              go(page.href);
            }}
          >
            {page.label}
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandGroup heading={t('actions')}>
        {tree.data?.canCreateBoards === true && workspaceId !== null ? (
          <CommandItem
            value={`action ${t('newBoard')}`}
            icon={<LayoutGrid aria-hidden="true" />}
            onSelect={() => {
              close();
              openDialog({ type: 'newBoard', workspaceId, folderId: null });
            }}
          >
            {t('newBoard')}
          </CommandItem>
        ) : null}
        {tree.data?.canManageFolders === true && workspaceId !== null ? (
          <CommandItem
            value={`action ${t('newFolder')}`}
            icon={<FolderPlus aria-hidden="true" />}
            onSelect={() => {
              close();
              openDialog({ type: 'newFolder', workspaceId, parentId: null });
            }}
          >
            {t('newFolder')}
          </CommandItem>
        ) : null}
        <CommandItem
          value={`action ${t('toggleTheme')}`}
          icon={<Moon aria-hidden="true" />}
          onSelect={() => {
            updatePreferences({
              theme: resolvedTheme(preferencesStore.getState().theme) === 'dark' ? 'light' : 'dark',
            });
            close();
          }}
        >
          {t('toggleTheme')}
        </CommandItem>
        <CommandItem
          value={`action ${t('toggleDensity')}`}
          icon={<Rows3 aria-hidden="true" />}
          onSelect={() => {
            updatePreferences({
              density:
                preferencesStore.getState().density === 'compact' ? 'comfortable' : 'compact',
            });
            close();
          }}
        >
          {t('toggleDensity')}
        </CommandItem>
        <CommandItem
          value={`action ${t('shortcuts')}`}
          icon={<Keyboard aria-hidden="true" />}
          shortcut="?"
          onSelect={() => {
            close();
            openDialog({ type: 'shortcuts' });
          }}
        >
          {t('shortcuts')}
        </CommandItem>
        <CommandItem
          value={`action ${t('switchOrganization')}`}
          icon={<Building2 aria-hidden="true" />}
          onSelect={() => {
            go('/organizations?next=/');
          }}
        >
          {t('switchOrganization')}
        </CommandItem>
        <CommandItem
          value={`action ${t('signOut')}`}
          icon={<LogOut aria-hidden="true" />}
          onSelect={() => {
            close();
            void signOut().then(() => {
              router.replace('/login');
            });
          }}
        >
          {t('signOut')}
        </CommandItem>
      </CommandGroup>
    </CommandDialog>
  );
}
