'use client';

import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  Modal,
  STATUS_PALETTE,
  Skeleton,
  toast,
} from '@cube-track/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CopyPlus,
  FolderInput,
  FolderPlus,
  ListTodo,
  MoreHorizontal,
  Palette,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type RefObject } from 'react';

import { apiBlob } from '@/lib/api/client';
import type { BoardDetail, Item } from '@/lib/api/types';
import { downloadBlob } from '@/lib/download';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import { useSession } from '@/stores/session';

import { BoardToolbar } from '../board/board-toolbar';
import { activeFilterCount, buildItemQuery } from '../board/query-builder';
import { listParams, updateBoardView, useBoardViewState } from '../board/store';
import { useBoardShortcuts, type BoardShortcut } from '../shell/shortcuts';
import { useMe } from '../shell/hooks';
import { BulkBar } from './bulk-bar';
import type { CellContext } from './cells';
import { ColumnDialog, type ColumnDialogMode } from './column-dialog';
import { toggleSort, type HeaderActions } from './grid-header';
import { TableGrid } from './grid';
import {
  useCellLocale,
  useColumnMutations,
  useCreateTableItem,
  useDependencies,
  useDirectory,
  useGroupMutations,
  useItemActions,
  useItemWriter,
  useSubitems,
  useTableItems,
  useTimer,
  type ItemWrite,
} from './hooks';
import { ImportDialog } from './import-dialog';
import {
  GROUP_LEVEL_GROUP,
  buildRows,
  gridColumns,
  isItemDone,
  mainStatusColumn,
  reorderKeys,
  todayIn,
  type TableRow,
} from './model';
import { MoveDialog, type MoveTarget } from './move-dialog';
import { RequiredFieldsDialog } from './required-dialog';
import { TrashDialog } from './trash-dialog';
import { redo, undo, useUndoAvailability } from './undo';

type Confirm = { title: string; description: string; action: () => void } | null;

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm; onClose: () => void }) {
  const tc = useTranslations('common');
  return (
    <Dialog
      open={confirm !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {confirm === null ? null : (
        <Modal
          title={confirm.title}
          description={confirm.description}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="ghost" onClick={onClose}>
                {tc('cancel')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  confirm.action();
                  onClose();
                }}
              >
                {tc('delete')}
              </Button>
            </>
          }
        />
      )}
    </Dialog>
  );
}

/**
 * View Tabela do board: dados com carregamento progressivo, grade virtualizada, menus de linha e
 * de grupo, ações em massa, diálogos (coluna, importar, mover, lixeira) e desfazer/refazer.
 */
export function TableView({
  board,
  searchRef,
}: {
  board: BoardDetail;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations('table');
  const tb = useTranslations('board.items');
  const tCells = useTranslations('table.cells');
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const state = useBoardViewState(board.id);
  const params = useMemo(() => listParams(state), [state]);
  const data = useTableItems(board, params);
  const [expanded, setExpanded] = useState<string[]>([]);
  const subitems = useSubitems(board, expanded);
  const allItems = useMemo(
    () => [...data.items, ...[...subitems.values()].flat()],
    [data.items, subitems],
  );
  const directory = useDirectory(allItems);
  const [rawSelected, setSelected] = useState<Set<string>>(new Set());
  // Seleção efetiva: ignora itens que saíram da lista (excluídos, filtrados, movidos).
  const selected = useMemo(() => {
    if (rawSelected.size === 0) return rawSelected;
    const present = new Set(allItems.map((item) => item.id));
    return new Set([...rawSelected].filter((id) => present.has(id)));
  }, [allItems, rawSelected]);
  const locale = useCellLocale();
  const me = useMe();
  const userId = useSession((session) => session.user?.id ?? '');
  const writer = useItemWriter(board);
  const createItem = useCreateTableItem(board);
  const runAction = useItemActions(board);
  const timer = useTimer(board.id);
  const dependencies = useDependencies(
    board.id,
    board.columns.some((column) => column.type === 'dependency'),
  );
  const columnMutations = useColumnMutations(board.id);
  const groupMutations = useGroupMutations(board.id);
  const { canUndo, canRedo } = useUndoAvailability(board.id);
  const [columnDialog, setColumnDialog] = useState<ColumnDialogMode | null>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [importing, setImporting] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [rowMenu, setRowMenu] = useState<{ item: Item; x: number; y: number } | null>(null);
  const [creating, setCreating] = useState(false);

  const canCreate = board.permissions.includes('item.create');
  const canManageColumns = board.permissions.includes('column.manage');
  const canManageGroups = board.permissions.includes('group.manage');
  const canDelete = board.permissions.includes('item.delete');
  const timezone = me.data?.user.timezone ?? 'America/Sao_Paulo';
  const today = todayIn(timezone);
  const mainStatus = mainStatusColumn(board);
  const filtered = activeFilterCount(params) > 0;

  const columns = useMemo(() => gridColumns(board, state, tb('name')), [board, state, tb]);
  const collapsed = useMemo(() => new Set(state.collapsed ?? []), [state.collapsed]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const memberName = useCallback(
    (id: string) => directory.people.find((person) => person.id === id)?.name ?? '…',
    [directory.people],
  );
  const rows = useMemo(
    () =>
      buildRows({
        board,
        items: data.items,
        levels: state.groupBy,
        labels: {
          none: t('groups.none'),
          checked: t('groups.checked'),
          unchecked: t('groups.unchecked'),
          person: memberName,
          month: (yearMonth) =>
            new Intl.DateTimeFormat(locale, {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(`${yearMonth}-15T12:00:00Z`)),
        },
        collapsed,
        expanded: expandedSet,
        subitems,
        canCreate,
        includeEmptyGroups: !filtered,
      }),
    [
      board,
      data.items,
      state.groupBy,
      t,
      memberName,
      locale,
      collapsed,
      expandedSet,
      subitems,
      canCreate,
      filtered,
    ],
  );

  const predecessors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const dependency of dependencies.data ?? [])
      counts.set(dependency.successorId, (counts.get(dependency.successorId) ?? 0) + 1);
    return counts;
  }, [dependencies.data]);
  const itemNames = useMemo(
    () => new Map(allItems.map((item) => [item.id, item.name])),
    [allItems],
  );

  const write = writer.write;
  const context: CellContext = useMemo(
    () => ({
      directory,
      locale,
      today,
      currentUserId: userId,
      t: tCells,
      itemNames,
      predecessors,
      isDone: (item) => isItemDone(board, item.values),
      onTimer: (item, column, action) => {
        timer.mutate({ itemId: item.id, columnKey: column.key, action });
      },
      onVote: (item, column) => {
        const current =
          (item.values[column.key] as { userIds?: string[] } | undefined)?.userIds ?? [];
        const next = current.includes(userId)
          ? current.filter((id) => id !== userId)
          : [...current, userId];
        void write(
          [{ item, values: { [column.key]: next.length === 0 ? null : { userIds: next } } }],
          t('undo.vote'),
        );
      },
    }),
    [board, directory, itemNames, locale, predecessors, t, tCells, timer, today, userId, write],
  );

  const selectedItems = useMemo(
    () => allItems.filter((item) => selected.has(item.id)),
    [allItems, selected],
  );

  // ------------------------------------------------------------------------ ações ---
  const runUndo = useCallback(async () => {
    try {
      const entry = await undo(board.id);
      if (entry !== null) toast.info(t('undo.undone', { label: entry.label }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [board.id, errorMessage, t]);
  const runRedo = useCallback(async () => {
    try {
      const entry = await redo(board.id);
      if (entry !== null) toast.info(t('undo.redone', { label: entry.label }));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [board.id, errorMessage, t]);

  const newItem = useCallback(async () => {
    const group = board.groups[0];
    if (group === undefined || !canCreate) return;
    setCreating(true);
    await createItem({ groupId: group.id, name: tb('newItemName') });
    setCreating(false);
  }, [board.groups, canCreate, createItem, tb]);

  const onShortcut = useCallback(
    (shortcut: BoardShortcut) => {
      if (shortcut === 'newItem') void newItem();
      else searchRef.current?.focus();
    },
    [newItem, searchRef],
  );
  useBoardShortcuts(onShortcut);

  const exportBoard = async (format: 'csv' | 'xlsx') => {
    try {
      const query = buildItemQuery(params, board.columns);
      const { blob, fileName } = await apiBlob(`/v1/boards/${board.id}/export`, {
        query: { format, locale, ...query },
      });
      downloadBlob(fileName ?? `${board.name}.${format}`, blob);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const targetsOf = (item: Item) =>
    selected.has(item.id) && selected.size > 1 ? [...selected] : [item.id];

  const deleteItems = (itemIds: string[]) => {
    void runAction({ action: 'delete', itemIds }).then((result) => {
      if (result !== null) setSelected(new Set());
    });
  };

  const addGroup = (afterId?: string) => {
    groupMutations.create.mutate({
      name: t('groups.newGroup'),
      color: STATUS_PALETTE[board.groups.length % STATUS_PALETTE.length]?.color ?? '#579bfc',
      ...(afterId === undefined ? {} : { position: { afterId } }),
    });
  };

  const toggleBucket = useCallback(
    (path: string) => {
      const current = new Set(state.collapsed ?? []);
      if (current.has(path)) current.delete(path);
      else current.add(path);
      updateBoardView(board.id, { collapsed: [...current] });
    },
    [board.id, state.collapsed],
  );

  const toggleExpand = useCallback((item: Item) => {
    setExpanded((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    );
  }, []);

  const headerActions: HeaderActions = {
    canManageColumns,
    onSort: (field, add) => {
      updateBoardView(board.id, { sort: toggleSort(state.sort, field, add) });
    },
    onSortDirection: (field, direction) => {
      updateBoardView(board.id, { sort: `${field}:${direction}` });
    },
    onResize: (key, width, done) => {
      updateBoardView(board.id, { columnWidths: { ...(state.columnWidths ?? {}), [key]: width } });
      const column = board.columns.find((entry) => entry.key === key);
      if (done && canManageColumns && column !== undefined)
        columnMutations.update.mutate({ columnId: column.id, input: { width } });
    },
    onReorder: (key, beforeKey) => {
      const order = columns.filter((column) => column.column !== null).map((column) => column.key);
      updateBoardView(board.id, { columnOrder: reorderKeys(order, key, beforeKey) });
      const column = board.columns.find((entry) => entry.key === key);
      if (canManageColumns && column !== undefined) {
        const last = order.filter((entry) => entry !== key).at(-1);
        columnMutations.update.mutate({
          columnId: column.id,
          input: {
            position:
              beforeKey === null ? (last === undefined ? {} : { afterKey: last }) : { beforeKey },
          },
        });
      }
    },
    onPin: (key, pinned) => {
      const current = state.pinnedColumnKeys ?? [];
      updateBoardView(board.id, {
        pinnedColumnKeys: pinned ? [...current, key] : current.filter((entry) => entry !== key),
      });
    },
    onHide: (key) => {
      updateBoardView(board.id, { hiddenColumnKeys: [...state.hiddenColumnKeys, key] });
    },
    onConfigure: (key) => {
      const column = board.columns.find((entry) => entry.key === key);
      if (column !== undefined) setColumnDialog({ kind: 'edit', column });
    },
    onDuplicate: (key, includeValues) => {
      const column = board.columns.find((entry) => entry.key === key);
      if (column !== undefined)
        columnMutations.duplicate.mutate({ columnId: column.id, includeValues });
    },
    onDelete: (key) => {
      const column = board.columns.find((entry) => entry.key === key);
      if (column === undefined) return;
      setConfirm({
        title: t('confirm.deleteColumnTitle', { name: column.title }),
        description: t('confirm.deleteColumn'),
        action: () => {
          columnMutations.remove.mutate(column.id);
        },
      });
    },
    onSetMainStatus: (key) => {
      columnMutations.statusColumn.mutate(key);
    },
    onAddColumn: () => {
      setColumnDialog({
        kind: 'create',
        ...(columns.at(-1)?.column === null ? {} : { afterKey: columns.at(-1)?.key ?? '' }),
      });
    },
  };

  const groupMenu = (row: Extract<TableRow, { kind: 'header' }>) => {
    const group =
      row.bucket.groupId === null
        ? undefined
        : board.groups.find((entry) => entry.id === row.bucket.groupId);
    const isBoardGroup = group !== undefined && state.groupBy[row.level] === GROUP_LEVEL_GROUP;
    const index = group === undefined ? -1 : board.groups.indexOf(group);
    const allPaths = rows
      .filter((entry): entry is Extract<TableRow, { kind: 'header' }> => entry.kind === 'header')
      .map((entry) => entry.path);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover"
            aria-label={t('groups.menu', { name: row.bucket.label })}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            icon={<ChevronsDownUp aria-hidden="true" />}
            onSelect={() => {
              updateBoardView(board.id, { collapsed: allPaths });
            }}
          >
            {t('groups.collapseAll')}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<ChevronsUpDown aria-hidden="true" />}
            onSelect={() => {
              updateBoardView(board.id, { collapsed: [] });
            }}
          >
            {t('groups.expandAll')}
          </DropdownMenuItem>
          {isBoardGroup && canCreate ? (
            <DropdownMenuItem
              icon={<Plus aria-hidden="true" />}
              onSelect={() => void createItem({ groupId: group.id, name: tb('newItemName') })}
            >
              {t('groups.addItem')}
            </DropdownMenuItem>
          ) : null}
          {isBoardGroup && canManageGroups ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<FolderPlus aria-hidden="true" />}
                onSelect={() => {
                  addGroup(group.id);
                }}
              >
                {t('groups.addBelow')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<Palette aria-hidden="true" />}>
                  {t('groups.color')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <div
                    className="grid grid-cols-5 gap-1 p-1"
                    role="group"
                    aria-label={t('groups.color')}
                  >
                    {STATUS_PALETTE.map((entry) => (
                      <DropdownMenuItem
                        key={entry.name}
                        aria-label={entry.color}
                        className="size-7 p-0"
                        style={{ backgroundColor: entry.color }}
                        onSelect={() => {
                          groupMutations.update.mutate({
                            groupId: group.id,
                            input: { color: entry.color },
                          });
                        }}
                      >
                        <span className="sr-only">{entry.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {index > 0 ? (
                <DropdownMenuItem
                  icon={<ArrowUp aria-hidden="true" />}
                  onSelect={() => {
                    groupMutations.update.mutate({
                      groupId: group.id,
                      input: { position: { beforeId: board.groups[index - 1]?.id ?? '' } },
                    });
                  }}
                >
                  {t('groups.moveUp')}
                </DropdownMenuItem>
              ) : null}
              {index < board.groups.length - 1 ? (
                <DropdownMenuItem
                  icon={<ArrowDown aria-hidden="true" />}
                  onSelect={() => {
                    groupMutations.update.mutate({
                      groupId: group.id,
                      input: { position: { afterId: board.groups[index + 1]?.id ?? '' } },
                    });
                  }}
                >
                  {t('groups.moveDown')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                icon={<Copy aria-hidden="true" />}
                onSelect={() => {
                  groupMutations.duplicate.mutate({ groupId: group.id, includeItems: true });
                }}
              >
                {t('groups.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<CopyPlus aria-hidden="true" />}
                onSelect={() => {
                  groupMutations.duplicate.mutate({ groupId: group.id, includeItems: false });
                }}
              >
                {t('groups.duplicateEmpty')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<ArrowRightLeft aria-hidden="true" />}
                onSelect={() => {
                  setMoveTarget({ type: 'group', groupId: group.id, name: group.name });
                }}
              >
                {t('groups.moveToBoard')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Archive aria-hidden="true" />}
                disabled={board.groups.length <= 1}
                onSelect={() => {
                  groupMutations.update.mutate({ groupId: group.id, input: { archived: true } });
                }}
              >
                {t('groups.archive')}
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                icon={<Trash2 aria-hidden="true" />}
                disabled={board.groups.length <= 1}
                onSelect={() => {
                  setConfirm({
                    title: t('confirm.deleteGroupTitle', { name: group.name }),
                    description: t('confirm.deleteGroup', { count: row.bucket.items.length }),
                    action: () => {
                      groupMutations.remove.mutate(group.id);
                    },
                  });
                }}
              >
                {t('groups.delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  if (data.isPending) {
    return (
      <div className="flex flex-col gap-2 px-4 sm:px-6" aria-busy="true">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-10" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }

  const menuItem = rowMenu?.item;
  const menuTargets = menuItem === undefined ? [] : targetsOf(menuItem);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BoardToolbar
        board={board}
        onNewItem={() => void newItem()}
        onImport={() => {
          setImporting(true);
        }}
        onExport={(format) => void exportBoard(format)}
        onTrash={() => {
          setShowTrash(true);
        }}
        onAddGroup={() => {
          addGroup();
        }}
        onRefresh={() => {
          void queryClient.invalidateQueries({ queryKey: qk.board(board.id) });
        }}
        onUndo={() => void runUndo()}
        onRedo={() => void runRedo()}
        canUndo={canUndo}
        canRedo={canRedo}
        searchRef={searchRef}
        creating={creating}
      />
      <div className="relative min-h-0 flex-1 border-t border-border">
        <TableGrid
          board={board}
          rows={rows}
          columns={columns}
          context={context}
          directory={directory}
          locale={locale}
          sort={state.sort}
          mainStatusKey={mainStatus?.key ?? null}
          headerActions={headerActions}
          selectedIds={selected}
          onSelectionChange={setSelected}
          expanded={expandedSet}
          onToggleExpand={toggleExpand}
          onToggleBucket={toggleBucket}
          onRenameGroup={(groupId, name) => {
            groupMutations.update.mutate({ groupId, input: { name } });
          }}
          canRenameGroups={canManageGroups}
          groupMenu={groupMenu}
          onOpenRowMenu={(item, anchor) => {
            setRowMenu({ item, ...anchor });
          }}
          onWrite={write}
          onCreate={(input) => void createItem(input)}
          onUndo={() => void runUndo()}
          onRedo={() => void runRedo()}
          emptyState={
            <EmptyState
              icon={<ListTodo aria-hidden="true" />}
              title={filtered ? tb('emptyFiltered') : t('empty')}
            />
          }
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {data.hasNextPage || data.isFetchingNextPage
          ? t('loadingMore', { count: data.items.length })
          : t('loaded', { count: data.items.length })}
      </p>
      {data.hasNextPage || data.isFetchingNextPage ? (
        <div
          className="pointer-events-none absolute bottom-3 start-1/2 z-20 -translate-x-1/2 rounded-full bg-surface-raised px-3 py-1 text-xs text-fg-muted shadow-md"
          aria-hidden="true"
        >
          {t('loadingMore', { count: data.items.length })}
        </div>
      ) : null}

      <DropdownMenu
        open={rowMenu !== null}
        onOpenChange={(open) => {
          if (!open) setRowMenu(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            className="pointer-events-none fixed size-px"
            style={{ left: rowMenu?.x ?? 0, top: rowMenu?.y ?? 0 }}
            aria-hidden="true"
          />
        </DropdownMenuTrigger>
        {menuItem === undefined ? null : (
          <DropdownMenuContent aria-label={t('rows.menu', { name: menuItem.name })}>
            {menuItem.parentItemId === null && canCreate ? (
              <DropdownMenuItem
                icon={<Plus aria-hidden="true" />}
                onSelect={() => {
                  if (!expanded.includes(menuItem.id)) setExpanded([...expanded, menuItem.id]);
                  void createItem({
                    groupId: menuItem.groupId,
                    name: t('rows.newSubitem'),
                    parentItemId: menuItem.id,
                  });
                }}
              >
                {t('rows.addSubitemAction')}
              </DropdownMenuItem>
            ) : null}
            {canCreate ? (
              <>
                <DropdownMenuItem
                  icon={<Copy aria-hidden="true" />}
                  onSelect={() => void runAction({ action: 'duplicate', itemIds: menuTargets })}
                >
                  {t('rows.duplicate', { count: menuTargets.length })}
                </DropdownMenuItem>
                {menuItem.parentItemId === null ? (
                  <DropdownMenuItem
                    icon={<CopyPlus aria-hidden="true" />}
                    onSelect={() =>
                      void runAction({
                        action: 'duplicate',
                        itemIds: menuTargets,
                        includeSubitems: true,
                      })
                    }
                  >
                    {t('rows.duplicateWithSubitems')}
                  </DropdownMenuItem>
                ) : null}
              </>
            ) : null}
            {menuItem.parentItemId === null ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger icon={<FolderInput aria-hidden="true" />}>
                  {t('rows.moveToGroup')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {board.groups
                    .filter((group) => group.id !== menuItem.groupId || menuTargets.length > 1)
                    .map((group) => (
                      <DropdownMenuItem
                        key={group.id}
                        onSelect={() =>
                          void runAction({
                            action: 'move',
                            itemIds: menuTargets,
                            target: { boardId: board.id, groupId: group.id },
                          })
                        }
                      >
                        <span
                          className="me-1 inline-block size-3 rounded-sm"
                          style={{ backgroundColor: group.color }}
                          aria-hidden="true"
                        />
                        {group.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {menuItem.parentItemId === null && canDelete ? (
              <DropdownMenuItem
                icon={<ArrowRightLeft aria-hidden="true" />}
                onSelect={() => {
                  setMoveTarget({ type: 'items', itemIds: menuTargets });
                }}
              >
                {t('rows.moveToBoard')}
              </DropdownMenuItem>
            ) : null}
            {canDelete ? <DropdownMenuSeparator /> : null}
            {canDelete ? (
              <DropdownMenuItem
                icon={<Archive aria-hidden="true" />}
                onSelect={() => void runAction({ action: 'archive', itemIds: menuTargets })}
              >
                {t('rows.archive', { count: menuTargets.length })}
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <DropdownMenuItem
                destructive
                icon={<Trash2 aria-hidden="true" />}
                onSelect={() => {
                  deleteItems(menuTargets);
                }}
              >
                {t('rows.delete', { count: menuTargets.length })}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {selectedItems.length > 0 ? (
        <BulkBar
          board={board}
          items={selectedItems}
          columns={columns}
          directory={directory}
          locale={locale}
          onWrite={(writes: ItemWrite[], label: string) => write(writes, label)}
          onDuplicate={() => void runAction({ action: 'duplicate', itemIds: [...selected] })}
          onMoveToGroup={(groupId) =>
            void runAction({
              action: 'move',
              itemIds: selectedItems
                .filter((item) => item.parentItemId === null)
                .map((item) => item.id),
              target: { boardId: board.id, groupId },
            })
          }
          onMoveToBoard={() => {
            setMoveTarget({
              type: 'items',
              itemIds: selectedItems
                .filter((item) => item.parentItemId === null)
                .map((item) => item.id),
            });
          }}
          onArchive={() =>
            void runAction({ action: 'archive', itemIds: [...selected] }).then(() => {
              setSelected(new Set());
            })
          }
          onDelete={() => {
            deleteItems([...selected]);
          }}
          onClear={() => {
            setSelected(new Set());
          }}
        />
      ) : null}

      <RequiredFieldsDialog />
      <ConfirmDialog
        confirm={confirm}
        onClose={() => {
          setConfirm(null);
        }}
      />
      <Dialog
        open={columnDialog !== null}
        onOpenChange={(open) => {
          if (!open) setColumnDialog(null);
        }}
      >
        {columnDialog === null ? null : (
          <ColumnDialog
            board={board}
            mode={columnDialog}
            onClose={() => {
              setColumnDialog(null);
            }}
          />
        )}
      </Dialog>
      <Dialog open={importing} onOpenChange={setImporting}>
        {importing ? (
          <ImportDialog
            board={board}
            onClose={() => {
              setImporting(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={showTrash} onOpenChange={setShowTrash}>
        {showTrash ? (
          <TrashDialog
            board={board}
            onClose={() => {
              setShowTrash(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={moveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null);
        }}
      >
        {moveTarget === null ? null : (
          <MoveDialog
            board={board}
            target={moveTarget}
            onClose={() => {
              setMoveTarget(null);
              setSelected(new Set());
            }}
          />
        )}
      </Dialog>
    </div>
  );
}
