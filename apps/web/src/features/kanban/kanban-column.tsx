'use client';

import type { CellTextDirectory, CellTextLocale } from '@cube-track/shared';
import { Button, IconButton, cn } from '@cube-track/ui';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, type MouseEvent } from 'react';

import type { BoardColumn, Item, Member } from '@/lib/api/types';

import { KanbanCard } from './kanban-card';
import type { KanbanBucketDef } from './model';

const CARD_HEIGHT_ESTIMATE = 96;

function SortableCard({
  item,
  fields,
  density,
  members,
  directory,
  locale,
  selected,
  onOpen,
  onToggleSelect,
}: {
  item: Item;
  fields: readonly BoardColumn[];
  density: 'compact' | 'detailed';
  members: readonly Member[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: (event: MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <KanbanCard
      ref={setNodeRef}
      item={item}
      fields={fields}
      density={density}
      members={members}
      directory={directory}
      locale={locale}
      selected={selected}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) onToggleSelect(event);
        else onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      {...attributes}
      {...listeners}
    />
  );
}

export interface KanbanColumnProps {
  cellId: string;
  bucket: KanbanBucketDef;
  items: readonly Item[];
  fields: readonly BoardColumn[];
  density: 'compact' | 'detailed';
  members: readonly Member[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string, event: MouseEvent) => void;
  onOpenItem: (id: string) => void;
  wipLimit: number | undefined;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onQuickCreate: (() => void) | null;
  isDragActive: boolean;
  width: number;
}

/** Uma coluna do Kanban (dentro de uma raia): cabeçalho com contagem/WIP e a lista de cartões. */
export function KanbanColumn({
  cellId,
  bucket,
  items,
  fields,
  density,
  members,
  directory,
  locale,
  selected,
  onToggleSelect,
  onOpenItem,
  wipLimit,
  collapsed,
  onToggleCollapse,
  onQuickCreate,
  isDragActive,
  width,
}: KanbanColumnProps) {
  const t = useTranslations('kanban');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setNodeRef: setDroppableRef } = useDroppable({ id: cellId });
  const setBodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      setDroppableRef(node);
    },
    [setDroppableRef],
  );
  const overLimit = wipLimit !== undefined && items.length > wipLimit;
  const ids = items.map((item) => item.id);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual devolve funções mutáveis
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT_ESTIMATE,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 4,
  });

  return (
    <div
      role="group"
      aria-label={bucket.label}
      className="flex h-full flex-col rounded-lg bg-surface-sunken"
      style={{ width: collapsed ? 44 : width, minWidth: collapsed ? 44 : width }}
    >
      <div className="flex items-center gap-1.5 px-2 py-2">
        <IconButton
          size="icon-sm"
          variant="ghost"
          label={collapsed ? t('column.expand', { name: bucket.label }) : t('column.collapse', { name: bucket.label })}
          icon={collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          onClick={onToggleCollapse}
        />
        {collapsed ? null : (
          <>
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: bucket.color }}
              aria-hidden="true"
            />
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{bucket.label}</h3>
            <span
              className={cn(
                'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium',
                overLimit ? 'bg-danger-soft text-danger' : 'bg-surface-raised text-fg-muted',
              )}
            >
              {wipLimit === undefined
                ? t('column.count', { count: items.length })
                : t('column.wip', { count: items.length, limit: wipLimit })}
            </span>
          </>
        )}
      </div>
      {collapsed ? null : (
        <>
          <div ref={setBodyRef} className="min-h-24 flex-1 overflow-y-auto px-2">
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {items.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-fg-subtle">{t('emptyColumn')}</p>
              ) : isDragActive ? (
                <div className="flex flex-col gap-2 pb-2">
                  {items.map((item) => (
                    <SortableCard
                      key={item.id}
                      item={item}
                      fields={fields}
                      density={density}
                      members={members}
                      directory={directory}
                      locale={locale}
                      selected={selected.has(item.id)}
                      onOpen={() => {
                        onOpenItem(item.id);
                      }}
                      onToggleSelect={(event) => {
                        onToggleSelect(item.id, event);
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ height: virtualizer.getTotalSize() }} className="relative pb-2">
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const item = items[virtualRow.index];
                    if (item === undefined) return null;
                    return (
                      <div
                        key={item.id}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        className="absolute inset-x-0 pb-2"
                        style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
                      >
                        <SortableCard
                          item={item}
                          fields={fields}
                          density={density}
                          members={members}
                          directory={directory}
                          locale={locale}
                          selected={selected.has(item.id)}
                          onOpen={() => {
                            onOpenItem(item.id);
                          }}
                          onToggleSelect={(event) => {
                            onToggleSelect(item.id, event);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </SortableContext>
          </div>
          {onQuickCreate === null ? null : (
            <div className="p-2">
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onQuickCreate}>
                <Plus aria-hidden="true" />
                {t('column.addCard')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
