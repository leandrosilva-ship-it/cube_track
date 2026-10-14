'use client';

import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  StatusPill,
} from '@cube-track/ui';
import {
  ArrowUpDown,
  Download,
  EyeOff,
  Filter,
  Layers,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useEffect, useState, type ReactNode } from 'react';

import type { BoardDetail } from '@/lib/api/types';
import { useSession } from '@/stores/session';

import { useMembers } from '../shell/hooks';
import { activeFilterCount } from './query-builder';
import { resetBoardFilters, updateBoardView, useBoardViewState } from './store';

const ToolbarButton = forwardRef<
  HTMLButtonElement,
  { icon: ReactNode; label: string; active?: boolean; count?: number }
>(function ToolbarButton({ icon, label, active = false, count, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant={active ? 'subtle' : 'ghost'}
      size="sm"
      aria-pressed={active}
      {...props}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
      <span className="sr-only md:hidden">{label}</span>
      {count !== undefined && count > 0 ? <Badge tone="primary">{count}</Badge> : null}
    </Button>
  );
});

export interface BoardToolbarProps {
  board: BoardDetail;
  onNewItem: () => void;
  onExport: () => void;
  onRefresh: () => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  creating: boolean;
}

/** Barra de ferramentas do board — filtros e ordenação são avaliados no servidor. */
export function BoardToolbar({
  board,
  onNewItem,
  onExport,
  onRefresh,
  searchRef,
  creating,
}: BoardToolbarProps) {
  const t = useTranslations('board.toolbar');
  const tc = useTranslations('common');
  const state = useBoardViewState(board.id);
  const members = useMembers();
  const userId = useSession((session) => session.user?.id ?? '');
  const [search, setSearch] = useState(state.search ?? '');
  const canCreate = board.permissions.includes('item.create');
  const statusColumn = board.columns.find((column) => column.type === 'status');
  const sortable = [
    { value: 'name', label: tc('name') },
    ...board.columns
      .filter((column) => ['status', 'date', 'number', 'text'].includes(column.type))
      .map((column) => ({ value: column.key, label: column.title })),
  ];
  const [sortField = '', sortDirection = 'asc'] = (state.sort ?? '').split(':');
  const filters = activeFilterCount(state);

  // Busca no servidor com debounce (evita uma requisição por tecla).
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((state.search ?? '') !== search) updateBoardView(board.id, { search });
    }, 300);
    return () => {
      clearTimeout(handle);
    };
  }, [search, state.search, board.id]);

  return (
    <div
      role="toolbar"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-1 px-4 py-2 sm:px-6"
    >
      {canCreate ? (
        <Button size="sm" onClick={onNewItem} loading={creating}>
          <Plus aria-hidden="true" />
          {t('newItem')}
        </Button>
      ) : null}
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="h-8 w-36 ps-8 sm:w-48"
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<UserRound aria-hidden="true" />}
            label={t('person')}
            active={state.personId !== undefined}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('personTitle')}>
          <p className="mb-2 text-xs font-semibold text-fg-muted">{t('personTitle')}</p>
          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {[
              ...(userId === '' ? [] : [{ userId, name: t('me'), avatarUrl: null }]),
              ...(members.data ?? []).filter(
                (member) => member.userId !== userId && member.status === 'active',
              ),
            ].map((member) => (
              <button
                key={member.userId}
                type="button"
                aria-pressed={state.personId === member.userId}
                onClick={() => {
                  updateBoardView(board.id, {
                    personId: state.personId === member.userId ? undefined : member.userId,
                  });
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover aria-pressed:bg-primary-soft aria-pressed:text-primary"
              >
                <Avatar
                  person={{ id: member.userId, name: member.name, avatarUrl: member.avatarUrl }}
                  size="sm"
                  decorative
                />
                <span className="truncate">{member.name}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {statusColumn === undefined ? null : (
        <Popover>
          <PopoverTrigger asChild>
            <ToolbarButton
              icon={<Filter aria-hidden="true" />}
              label={t('filter')}
              active={(state.statusLabelIds?.length ?? 0) > 0}
              count={state.statusLabelIds?.length ?? 0}
            />
          </PopoverTrigger>
          <PopoverContent aria-label={t('filterTitle')}>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-semibold text-fg-muted">
                {t('filterTitle')}: {statusColumn.title}
              </legend>
              {statusColumn.labels.map((label) => {
                const checked = state.statusLabelIds?.includes(label.id) ?? false;
                return (
                  <div key={label.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`status-${label.id}`}
                      checked={checked}
                      onCheckedChange={(next) => {
                        const current = state.statusLabelIds ?? [];
                        updateBoardView(board.id, {
                          statusLabelIds:
                            next === true
                              ? [...current, label.id]
                              : current.filter((id) => id !== label.id),
                        });
                      }}
                    />
                    <label htmlFor={`status-${label.id}`} className="cursor-pointer">
                      <StatusPill label={label.label} color={label.color} className="min-w-28" />
                    </label>
                  </div>
                );
              })}
            </fieldset>
          </PopoverContent>
        </Popover>
      )}

      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<ArrowUpDown aria-hidden="true" />}
            label={t('sort')}
            active={state.sort !== undefined}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('sortTitle')} className="flex flex-col gap-3">
          <Select
            aria-label={t('sortTitle')}
            placeholder={t('sortTitle')}
            {...(sortField === '' ? {} : { value: sortField })}
            options={sortable}
            onValueChange={(value) => {
              updateBoardView(board.id, { sort: `${value}:${sortDirection}` });
            }}
          />
          <Select
            aria-label={t('sortTitle')}
            value={sortDirection}
            disabled={sortField === ''}
            options={[
              { value: 'asc', label: t('sortAsc') },
              { value: 'desc', label: t('sortDesc') },
            ]}
            onValueChange={(value) => {
              if (sortField !== '') updateBoardView(board.id, { sort: `${sortField}:${value}` });
            }}
          />
          {state.sort === undefined ? null : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                updateBoardView(board.id, { sort: undefined });
              }}
            >
              {tc('clear')}
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<EyeOff aria-hidden="true" />}
            label={t('hide')}
            active={state.hiddenColumnKeys.length > 0}
            count={state.hiddenColumnKeys.length}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('hideTitle')}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-semibold text-fg-muted">{t('hideTitle')}</legend>
            {board.columns.map((column) => {
              const visible = !state.hiddenColumnKeys.includes(column.key);
              return (
                <div key={column.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`col-${column.key}`}
                    checked={visible}
                    onCheckedChange={(next) => {
                      updateBoardView(board.id, {
                        hiddenColumnKeys:
                          next === true
                            ? state.hiddenColumnKeys.filter((key) => key !== column.key)
                            : [...state.hiddenColumnKeys, column.key],
                      });
                    }}
                  />
                  <label htmlFor={`col-${column.key}`}>{column.title}</label>
                </div>
              );
            })}
          </fieldset>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<Layers aria-hidden="true" />}
            label={t('groupBy')}
            active={state.groupBy !== 'group'}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('groupBy')}>
          <Select
            aria-label={t('groupBy')}
            value={state.groupBy}
            options={[
              { value: 'group', label: t('groupByGroup') },
              ...board.columns
                .filter((column) => column.type === 'status')
                .map((column) => ({ value: column.key, label: column.title })),
            ]}
            onValueChange={(value) => {
              updateBoardView(board.id, { groupBy: value });
            }}
          />
        </PopoverContent>
      </Popover>

      {filters > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch('');
            resetBoardFilters(board.id);
          }}
        >
          <X aria-hidden="true" />
          {t('clearFilters')}
          <span className="sr-only">({t('activeFilters', { count: filters })})</span>
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('more')}
            icon={<MoreHorizontal aria-hidden="true" />}
            size="icon-sm"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<Download aria-hidden="true" />} onSelect={onExport}>
            {t('exportCsv')}
          </DropdownMenuItem>
          <DropdownMenuItem icon={<RefreshCw aria-hidden="true" />} onSelect={onRefresh}>
            {t('refresh')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
