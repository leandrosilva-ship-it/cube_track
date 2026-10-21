'use client';

import type { CellTextDirectory, CellTextLocale, KanbanConfig } from '@cube-track/shared';
import { toast } from '@cube-track/ui';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type MouseEvent } from 'react';

import type { BoardDetail, Item, Member } from '@/lib/api/types';

import type { ItemWrite } from '../table/hooks';
import { KanbanCard } from './kanban-card';
import { KanbanColumn } from './kanban-column';
import {
  ALL_SWIMLANE,
  cellId,
  kanbanBucketsFor,
  kanbanCells,
  KANBAN_FIELD_TYPES,
  valueForBucket,
  type KanbanBucketDef,
} from './model';

const COLUMN_WIDTH = 280;

function parseCellId(id: string): { swimlaneKey: string; columnKey: string } {
  const [swimlaneKey = ALL_SWIMLANE, columnKey = ''] = id.split('::');
  return { swimlaneKey, columnKey };
}

export interface KanbanBoardProps {
  board: BoardDetail;
  config: KanbanConfig;
  items: readonly Item[];
  members: readonly Member[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
  write: (writes: ItemWrite[], label: string) => Promise<boolean>;
  canCreate: boolean;
  onOpenItem: (id: string) => void;
  onQuickCreate: (groupId: string, columnValues: Record<string, unknown>) => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (id: string, event: MouseEvent) => void;
  collapsedColumnKeys: readonly string[];
  onToggleCollapse: (key: string) => void;
}

/** Quadro Kanban: raias × colunas, arrastar-e-soltar entre células (ADR 0045). */
export function KanbanBoard({
  board,
  config,
  items,
  members,
  directory,
  locale,
  write,
  canCreate,
  onOpenItem,
  onQuickCreate,
  selected,
  onToggleSelect,
  collapsedColumnKeys,
  onToggleCollapse,
}: KanbanBoardProps) {
  const t = useTranslations('kanban');
  const labels = useMemo(
    () => ({
      none: t('emptyColumn'),
      checked: t('checked'),
      unchecked: t('unchecked'),
      person: (id: string) => members.find((member) => member.userId === id)?.name ?? id,
    }),
    [members, t],
  );
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const columns = useMemo(
    () => kanbanBucketsFor(board, config.columnsBy, items, labels, config.hideEmptyColumns),
    [board, config.columnsBy, config.hideEmptyColumns, items, labels],
  );
  const swimlanes = useMemo<KanbanBucketDef[]>(
    () =>
      config.swimlanesBy === undefined
        ? [{ key: ALL_SWIMLANE, label: '', color: '', groupId: null }]
        : kanbanBucketsFor(board, config.swimlanesBy, items, labels, false),
    [board, config.swimlanesBy, items, labels],
  );
  const cells = useMemo(() => kanbanCells(board, items, config), [board, items, config]);
  const baseCells = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const swimlane of swimlanes) {
      for (const column of columns) {
        const id = cellId(swimlane.key, column.key);
        map[id] = (cells.get(id) ?? []).map((item) => item.id);
      }
    }
    return map;
  }, [swimlanes, columns, cells]);

  const [activeId, setActiveId] = useState<string | null>(null);
  // `null` fora de um arraste: a célula exibida é sempre a verdade do servidor (`baseCells`).
  const [dragCells, setDragCells] = useState<Record<string, string[]> | null>(null);
  const localCells = dragCells ?? baseCells;

  const columnsByField = config.columnsBy === 'group' ? null : board.columns.find((c) => c.key === config.columnsBy) ?? null;
  const swimlanesByField =
    config.swimlanesBy === undefined || config.swimlanesBy === 'group'
      ? null
      : board.columns.find((c) => c.key === config.swimlanesBy) ?? null;
  const canDrag =
    (config.columnsBy === 'group' || (columnsByField !== null && KANBAN_FIELD_TYPES.has(columnsByField.type))) &&
    (config.swimlanesBy === undefined ||
      config.swimlanesBy === 'group' ||
      (swimlanesByField !== null && KANBAN_FIELD_TYPES.has(swimlanesByField.type)));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const findContainer = (id: string): string | undefined => {
    if (id in localCells) return id;
    return Object.entries(localCells).find(([, ids]) => ids.includes(id))?.[0];
  };

  const cardName = (id: string) => itemsById.get(id)?.name ?? '';

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragCells(baseCells);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (over === null) return;
    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id)) ?? String(over.id);
    if (activeContainer === undefined || activeContainer === overContainer) return;
    setDragCells((current) => {
      if (current === null) return current;
      const activeItems = current[activeContainer] ?? [];
      const overItems = current[overContainer] ?? [];
      const activeIndex = activeItems.indexOf(String(active.id));
      if (activeIndex === -1) return current;
      const overIndex = overItems.indexOf(String(over.id));
      const newIndex = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...current,
        [activeContainer]: activeItems.filter((id) => id !== String(active.id)),
        [overContainer]: [
          ...overItems.slice(0, newIndex),
          String(active.id),
          ...overItems.slice(newIndex),
        ],
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    setActiveId(null);
    if (over === null) {
      setDragCells(null);
      return;
    }
    const finalContainer = findContainer(id);
    const originalContainer = Object.entries(baseCells).find(([, ids]) => ids.includes(id))?.[0];
    const item = itemsById.get(id);
    if (finalContainer === undefined || item === undefined) {
      setDragCells(null);
      return;
    }
    const { swimlaneKey, columnKey } = parseCellId(finalContainer);
    const changedContainer = finalContainer !== originalContainer;
    if (changedContainer && config.wipBlock) {
      const limit = config.wipLimits[columnKey];
      const currentCount = columns.find((column) => column.key === columnKey) === undefined
        ? 0
        : Object.entries(localCells)
            .filter(([key]) => parseCellId(key).columnKey === columnKey)
            .reduce((sum, [, ids]) => sum + ids.length, 0);
      if (limit !== undefined && currentCount > limit) {
        setDragCells(null);
        toast.warning(t('dnd.wipBlocked', { limit }));
        return;
      }
    }
    const neighbors = localCells[finalContainer] ?? [];
    const index = neighbors.indexOf(id);
    const afterId = index > 0 ? neighbors[index - 1] : undefined;
    const beforeId = index === 0 && neighbors.length > 1 ? neighbors[1] : undefined;
    const values: ItemWrite['values'] = {};
    let groupId: string | undefined;
    if (changedContainer) {
      if (config.columnsBy === 'group') groupId = columnKey;
      else if (columnsByField !== null) values[config.columnsBy] = valueForBucket(columnsByField, columnKey);
      if (config.swimlanesBy === 'group') groupId = swimlaneKey;
      else if (config.swimlanesBy !== undefined && swimlanesByField !== null)
        values[config.swimlanesBy] = valueForBucket(swimlanesByField, swimlaneKey);
    }
    const itemWrite: ItemWrite = {
      item,
      values,
      ...(groupId === undefined ? {} : { groupId }),
      ...(afterId === undefined && beforeId === undefined
        ? {}
        : { position: { ...(afterId === undefined ? {} : { afterId }), ...(beforeId === undefined ? {} : { beforeId }) } }),
    };
    if (Object.keys(values).length === 0 && groupId === undefined && itemWrite.position === undefined) return;
    void write([itemWrite], t('dnd.dropped', { name: item.name })).then((ok) => {
      if (!ok) setDragCells(null);
    });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t('dnd.picked', { name: cardName(String(active.id)) }),
    onDragOver: ({ active, over }) =>
      over === null
        ? t('dnd.picked', { name: cardName(String(active.id)) })
        : t('dnd.movedOver', {
            name: cardName(String(active.id)),
            target: parseCellId(findContainer(String(over.id)) ?? String(over.id)).columnKey,
          }),
    onDragEnd: ({ active }) => t('dnd.dropped', { name: cardName(String(active.id)) }),
    onDragCancel: ({ active }) => t('dnd.canceled', { name: cardName(String(active.id)) }),
  };
  const instructions: ScreenReaderInstructions = { draggable: t('dnd.dragHint') };

  const activeItem = activeId === null ? undefined : itemsById.get(activeId);

  const body = (
    <div className="flex h-full flex-col gap-4 overflow-x-auto overflow-y-auto p-3">
      {swimlanes.map((swimlane) => {
        const laneTotal = columns.reduce(
          (sum, column) => sum + (baseCells[cellId(swimlane.key, column.key)]?.length ?? 0),
          0,
        );
        return (
          <div key={swimlane.key} className="flex flex-col gap-2">
            {config.swimlanesBy === undefined ? null : (
              <div className="flex items-center gap-2 px-1">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: swimlane.color }}
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold text-fg">{swimlane.label}</h2>
                <div className="ms-2 flex h-1.5 flex-1 max-w-64 overflow-hidden rounded-full bg-surface-sunken">
                  {laneTotal > 0
                    ? columns.map((column) => {
                        const count = baseCells[cellId(swimlane.key, column.key)]?.length ?? 0;
                        return count === 0 ? null : (
                          <div
                            key={column.key}
                            style={{ width: `${String((count / laneTotal) * 100)}%`, backgroundColor: column.color }}
                          />
                        );
                      })
                    : null}
                </div>
              </div>
            )}
            <div className="flex items-stretch gap-3">
              {columns.map((column) => {
                const id = cellId(swimlane.key, column.key);
                const ids = localCells[id] ?? [];
                const cellItems = ids
                  .map((itemId) => itemsById.get(itemId))
                  .filter((entry): entry is Item => entry !== undefined);
                return (
                  <KanbanColumn
                    key={id}
                    cellId={id}
                    bucket={column}
                    items={cellItems}
                    fields={config.cardFields
                      .map((key) => board.columns.find((entry) => entry.key === key))
                      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)}
                    density={config.cardDensity}
                    members={members}
                    directory={directory}
                    locale={locale}
                    selected={selected}
                    onToggleSelect={onToggleSelect}
                    onOpenItem={onOpenItem}
                    wipLimit={config.wipLimits[column.key]}
                    collapsed={collapsedColumnKeys.includes(column.key)}
                    onToggleCollapse={() => {
                      onToggleCollapse(column.key);
                    }}
                    onQuickCreate={
                      !canCreate
                        ? null
                        : () => {
                            const groupId =
                              config.columnsBy === 'group'
                                ? column.key
                                : config.swimlanesBy === 'group'
                                  ? swimlane.key
                                  : (board.groups[0]?.id ?? '');
                            const values: Record<string, unknown> = {};
                            if (config.columnsBy !== 'group' && columnsByField !== null) {
                              const value = valueForBucket(columnsByField, column.key);
                              if (value !== null) values[config.columnsBy] = value;
                            }
                            onQuickCreate(groupId, values);
                          }
                    }
                    isDragActive={activeId !== null}
                    width={COLUMN_WIDTH}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (!canDrag) return body;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragCells(null);
      }}
      accessibility={{ announcements, screenReaderInstructions: instructions }}
    >
      {body}
      <DragOverlay>
        {activeItem === undefined ? null : (
          <KanbanCard
            item={activeItem}
            fields={config.cardFields
              .map((key) => board.columns.find((entry) => entry.key === key))
              .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)}
            density={config.cardDensity}
            members={members}
            directory={directory}
            locale={locale}
            selected={false}
            className="rotate-2 shadow-lg"
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
