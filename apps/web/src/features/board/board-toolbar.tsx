'use client';

import type { FilterGroup } from '@cube-track/shared';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
} from '@cube-track/ui';
import {
  ArrowUpDown,
  Download,
  EyeOff,
  FileSpreadsheet,
  Filter,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { BoardDetail } from '@/lib/api/types';

import { useMembers } from '../shell/hooks';
import { FilterBuilder } from '../table/filter-builder';
import { filterFields } from '../table/filters';
import { SORTABLE_TYPES, sortTerms } from '../table/grid-header';
import { GROUPABLE_TYPES } from '../table/model';
import { activeFilterCount, countConditions, pruneFilter } from './query-builder';
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
  onImport: () => void;
  onExport: (format: 'csv' | 'xlsx') => void;
  onTrash: () => void;
  onAddGroup: () => void;
  onRefresh: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  searchRef: React.RefObject<HTMLInputElement | null>;
  creating: boolean;
}

const EMPTY_FILTER: FilterGroup = { op: 'and', conditions: [] };

/** Barra de ferramentas do board — filtros, busca e ordenação são avaliados no servidor. */
export function BoardToolbar({
  board,
  onNewItem,
  onImport,
  onExport,
  onTrash,
  onAddGroup,
  onRefresh,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  searchRef,
  creating,
}: BoardToolbarProps) {
  const t = useTranslations('board.toolbar');
  const tf = useTranslations('table.filters');
  const tc = useTranslations('common');
  const state = useBoardViewState(board.id);
  const members = useMembers();
  const [search, setSearch] = useState(state.search ?? '');
  const canCreate = board.permissions.includes('item.create');
  const canManageGroups = board.permissions.includes('group.manage');
  const canExport =
    board.permissions.includes('board.export') || board.permissions.includes('board.manage');
  const filters = activeFilterCount(state);
  const advancedCount = countConditions(
    state.filter === undefined ? undefined : (pruneFilter(state.filter) ?? undefined),
  );
  const terms = sortTerms(state.sort);
  const fields = useMemo(
    () =>
      filterFields(board.columns, {
        name: tc('name'),
        group: tf('group'),
        createdAt: tf('createdAt'),
        updatedAt: tf('updatedAt'),
      }),
    [board.columns, tc, tf],
  );
  const sortable = [
    { value: 'name', label: tc('name') },
    ...board.columns
      .filter((column) => SORTABLE_TYPES.has(column.type) && !column.isHidden)
      .map((column) => ({ value: column.key, label: column.title })),
    { value: 'created_at', label: tf('createdAt') },
    { value: 'updated_at', label: tf('updatedAt') },
  ];
  const groupable = [
    { value: 'group', label: t('groupByGroup') },
    ...board.columns
      .filter((column) => GROUPABLE_TYPES.has(column.type) && !column.isHidden)
      .map((column) => ({ value: column.key, label: column.title })),
  ];

  // Busca no servidor com debounce (evita uma requisição por tecla).
  useEffect(() => {
    const handle = setTimeout(() => {
      if ((state.search ?? '') !== search) updateBoardView(board.id, { search });
    }, 300);
    return () => {
      clearTimeout(handle);
    };
  }, [search, state.search, board.id]);

  const setSort = (next: { field: string; direction: 'asc' | 'desc' }[]) => {
    updateBoardView(board.id, {
      sort:
        next.length === 0
          ? undefined
          : next.map((term) => `${term.field}:${term.direction}`).join(','),
    });
  };

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
              { userId: 'me', name: t('me'), avatarUrl: null },
              ...(members.data ?? []).filter((member) => member.status === 'active'),
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

      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<Filter aria-hidden="true" />}
            label={t('filter')}
            active={advancedCount > 0}
            count={advancedCount}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('filterTitle')} className="w-[min(44rem,calc(100vw-2rem))]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t('filterTitle')}</p>
            <div className="flex gap-1">
              {advancedCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    updateBoardView(board.id, { filter: undefined });
                  }}
                >
                  {tc('clear')}
                </Button>
              ) : null}
            </div>
          </div>
          <FilterBuilder
            board={board}
            fields={fields}
            members={members.data ?? []}
            value={state.filter ?? EMPTY_FILTER}
            onChange={(filter) => {
              updateBoardView(board.id, {
                filter: filter.conditions.length === 0 ? undefined : filter,
              });
            }}
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <ToolbarButton
            icon={<ArrowUpDown aria-hidden="true" />}
            label={t('sort')}
            active={terms.length > 0}
            count={terms.length}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('sortTitle')} className="flex w-96 flex-col gap-2">
          <p className="text-sm font-semibold">{t('sortTitle')}</p>
          {terms.map((term, index) => (
            <div key={`${term.field}-${String(index)}`} className="flex items-center gap-2">
              <Select
                className="h-8 flex-1"
                aria-label={t('sortField', { index: index + 1 })}
                value={term.field}
                options={sortable.filter(
                  (option) =>
                    option.value === term.field ||
                    !terms.some((other) => other.field === option.value),
                )}
                onValueChange={(field) => {
                  setSort(
                    terms.map((other, position) =>
                      position === index ? { ...other, field } : other,
                    ),
                  );
                }}
              />
              <Select
                className="h-8 w-36"
                aria-label={t('sortDirection', { index: index + 1 })}
                value={term.direction}
                options={[
                  { value: 'asc', label: t('sortAsc') },
                  { value: 'desc', label: t('sortDesc') },
                ]}
                onValueChange={(direction) => {
                  setSort(
                    terms.map((other, position) =>
                      position === index
                        ? { ...other, direction: direction as 'asc' | 'desc' }
                        : other,
                    ),
                  );
                }}
              />
              <IconButton
                size="icon-sm"
                label={tc('remove')}
                icon={<X aria-hidden="true" />}
                onClick={() => {
                  setSort(terms.filter((_, position) => position !== index));
                }}
              />
            </div>
          ))}
          {terms.length < 3 ? (
            <Select
              className="h-8"
              aria-label={t('sortAdd')}
              placeholder={terms.length === 0 ? t('sortTitle') : t('sortAdd')}
              options={sortable.filter(
                (option) => !terms.some((term) => term.field === option.value),
              )}
              onValueChange={(field) => {
                setSort([...terms, { field, direction: 'asc' }]);
              }}
            />
          ) : null}
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
          <fieldset className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            <legend className="mb-2 text-xs font-semibold text-fg-muted">{t('hideTitle')}</legend>
            {board.columns
              .filter((column) => !column.isHidden)
              .map((column) => {
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
            active={state.groupBy.length !== 1 || state.groupBy[0] !== 'group'}
          />
        </PopoverTrigger>
        <PopoverContent aria-label={t('groupBy')} className="flex flex-col gap-2">
          <p className="text-sm font-semibold">{t('groupBy')}</p>
          {state.groupBy.map((level, index) => (
            <div key={`${level}-${String(index)}`} className="flex items-center gap-2">
              <Select
                className="h-8 flex-1"
                aria-label={t('groupLevel', { index: index + 1 })}
                value={level}
                options={groupable.filter(
                  (option) => option.value === level || !state.groupBy.includes(option.value),
                )}
                onValueChange={(value) => {
                  updateBoardView(board.id, {
                    groupBy: state.groupBy.map((other, position) =>
                      position === index ? value : other,
                    ),
                  });
                }}
              />
              {state.groupBy.length > 1 ? (
                <IconButton
                  size="icon-sm"
                  label={tc('remove')}
                  icon={<X aria-hidden="true" />}
                  onClick={() => {
                    updateBoardView(board.id, {
                      groupBy: state.groupBy.filter((_, position) => position !== index),
                    });
                  }}
                />
              ) : null}
            </div>
          ))}
          {state.groupBy.length < 3 ? (
            <Select
              className="h-8"
              aria-label={t('groupAdd')}
              placeholder={t('groupAdd')}
              options={groupable.filter((option) => !state.groupBy.includes(option.value))}
              onValueChange={(value) => {
                updateBoardView(board.id, { groupBy: [...state.groupBy, value] });
              }}
            />
          ) : null}
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

      <div className="ms-auto flex items-center gap-1">
        <IconButton
          size="icon-sm"
          label={t('undo')}
          icon={<Undo2 aria-hidden="true" />}
          disabled={!canUndo}
          onClick={onUndo}
        />
        <IconButton
          size="icon-sm"
          label={t('redo')}
          icon={<Redo2 aria-hidden="true" />}
          disabled={!canRedo}
          onClick={onRedo}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={t('more')}
              icon={<MoreHorizontal aria-hidden="true" />}
              size="icon-sm"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canManageGroups ? (
              <DropdownMenuItem icon={<FolderPlus aria-hidden="true" />} onSelect={onAddGroup}>
                {t('addGroup')}
              </DropdownMenuItem>
            ) : null}
            {canCreate ? (
              <DropdownMenuItem icon={<Upload aria-hidden="true" />} onSelect={onImport}>
                {t('import')}
              </DropdownMenuItem>
            ) : null}
            {canExport ? (
              <>
                <DropdownMenuItem
                  icon={<Download aria-hidden="true" />}
                  onSelect={() => {
                    onExport('csv');
                  }}
                >
                  {t('exportCsv')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  icon={<FileSpreadsheet aria-hidden="true" />}
                  onSelect={() => {
                    onExport('xlsx');
                  }}
                >
                  {t('exportXlsx')}
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 aria-hidden="true" />} onSelect={onTrash}>
              {t('trash')}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<RefreshCw aria-hidden="true" />} onSelect={onRefresh}>
              {t('refresh')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
