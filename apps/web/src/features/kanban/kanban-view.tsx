'use client';

import { Button, Dialog, IconButton, Input, Popover, PopoverContent, PopoverTrigger } from '@cube-track/ui';
import { Avatar } from '@cube-track/ui';
import { Search, Settings2, UserRound, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';

import type { BoardDetail, BoardView } from '@/lib/api/types';
import type { ItemListParams } from '@/lib/query/keys';

import { setItemPanelOrder } from '../collaboration/item-panel-store';
import { useOpenItemPanel } from '../collaboration/use-open-item-panel';
import { BulkBar } from '../table/bulk-bar';
import {
  useCellLocale,
  useCreateTableItem,
  useDirectory,
  useItemActions,
  useItemWriter,
  useTableItems,
} from '../table/hooks';
import { gridColumns } from '../table/model';
import { MoveDialog, type MoveTarget } from '../table/move-dialog';
import { useMembers } from '../shell/hooks';
import { KanbanBoard } from './kanban-board';
import { KanbanSettingsDialog } from './kanban-settings-dialog';
import { useKanbanConfig } from './use-kanban-config';

export interface KanbanViewProps {
  board: BoardDetail;
  view: BoardView;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/** View Kanban: filtros rápidos, quadro (colunas/raias/cartões) e ações em massa. */
export function KanbanView({ board, view, searchRef }: KanbanViewProps) {
  const t = useTranslations('kanban');
  const tc = useTranslations('common');
  const { config, setConfig, canEdit } = useKanbanConfig(board.id, view);
  const members = useMembers();
  const [search, setSearch] = useState('');
  const [personId, setPersonId] = useState<string | undefined>(undefined);
  const params: ItemListParams = useMemo(
    () => ({
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(personId === undefined ? {} : { personId }),
    }),
    [search, personId],
  );
  const query = useTableItems(board, params);
  const directory = useDirectory(query.items);
  const locale = useCellLocale();
  const { write } = useItemWriter(board);
  const createItem = useCreateTableItem(board);
  const runAction = useItemActions(board);
  const canCreate = board.permissions.includes('item.create');
  useEffect(() => {
    setItemPanelOrder(board.id, query.items.map((item) => item.id));
  }, [board.id, query.items]);

  const openItem = useOpenItemPanel();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggleSelect = (id: string, event: MouseEvent) => {
    setSelected((current) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return current.size === 1 && current.has(id) ? new Set() : new Set([id]);
    });
  };

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const selectedItems = query.items.filter((item) => selected.has(item.id));
  const columns = useMemo(() => gridColumns(board, { hiddenColumnKeys: [] }, tc('name')), [board, tc]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="toolbar" aria-label={t('settings.title')} className="flex items-center gap-1 px-4 py-2 sm:px-6">
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
            placeholder={t('quickFilters.searchPlaceholder')}
            aria-label={t('quickFilters.search')}
            className="h-8 w-36 ps-8 sm:w-48"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant={personId === undefined ? 'ghost' : 'subtle'} size="sm" aria-pressed={personId !== undefined}>
              <UserRound aria-hidden="true" />
              <span className="hidden md:inline">{t('quickFilters.person')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label={t('quickFilters.personTitle')}>
            <p className="mb-2 text-xs font-semibold text-fg-muted">{t('quickFilters.personTitle')}</p>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {[
                { userId: 'me', name: t('quickFilters.me'), avatarUrl: null },
                ...(members.data ?? []).filter((member) => member.status === 'active'),
              ].map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  aria-pressed={personId === member.userId}
                  onClick={() => {
                    setPersonId((current) => (current === member.userId ? undefined : member.userId));
                  }}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover aria-pressed:bg-primary-soft aria-pressed:text-primary"
                >
                  <Avatar person={{ id: member.userId, name: member.name, avatarUrl: member.avatarUrl }} size="sm" decorative />
                  <span className="truncate">{member.name}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {search !== '' || personId !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setPersonId(undefined);
            }}
          >
            <X aria-hidden="true" />
            {t('quickFilters.clear')}
          </Button>
        ) : null}
        <div className="ms-auto">
          {canEdit ? (
            <IconButton
              label={t('settings.title')}
              icon={<Settings2 aria-hidden="true" />}
              size="icon-sm"
              onClick={() => {
                setSettingsOpen(true);
              }}
            />
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <KanbanBoard
          board={board}
          config={config}
          items={query.items}
          members={members.data ?? []}
          directory={directory}
          locale={locale}
          write={write}
          canCreate={canCreate}
          onOpenItem={openItem}
          onQuickCreate={(groupId, values) => {
            void createItem({ groupId, name: t('column.newCardName'), values });
          }}
          selected={selected}
          onToggleSelect={toggleSelect}
          collapsedColumnKeys={config.collapsedColumnKeys}
          onToggleCollapse={(key) => {
            setConfig({
              collapsedColumnKeys: config.collapsedColumnKeys.includes(key)
                ? config.collapsedColumnKeys.filter((entry) => entry !== key)
                : [...config.collapsedColumnKeys, key],
            });
          }}
        />
      </div>
      {selectedItems.length === 0 ? null : (
        <BulkBar
          board={board}
          items={selectedItems}
          columns={columns}
          directory={directory}
          locale={locale}
          onWrite={write}
          onDuplicate={() => {
            void runAction({ action: 'duplicate', itemIds: selectedItems.map((item) => item.id) });
          }}
          onMoveToGroup={(groupId) => {
            void runAction({
              action: 'move',
              itemIds: selectedItems.map((item) => item.id),
              target: { boardId: board.id, groupId },
            });
          }}
          onMoveToBoard={() => {
            setMoveTarget({ type: 'items', itemIds: selectedItems.map((item) => item.id) });
          }}
          onArchive={() => {
            void runAction({ action: 'archive', itemIds: selectedItems.map((item) => item.id) });
            setSelected(new Set());
          }}
          onDelete={() => {
            void runAction({ action: 'delete', itemIds: selectedItems.map((item) => item.id) });
            setSelected(new Set());
          }}
          onClear={() => {
            setSelected(new Set());
          }}
        />
      )}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        {settingsOpen ? (
          <KanbanSettingsDialog
            board={board}
            config={config}
            onChange={setConfig}
            onClose={() => {
              setSettingsOpen(false);
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
