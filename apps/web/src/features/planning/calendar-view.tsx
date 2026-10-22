'use client';

import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { Button, cn, EmptyState, IconButton, Tabs, TabsList, TabsTrigger } from '@cube-track/ui';
import { shiftDays } from '@cube-track/shared';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { BoardDetail, BoardView, Item } from '@/lib/api/types';
import type { ItemListParams } from '@/lib/query/keys';

import { useOpenItemPanel } from '../collaboration/use-open-item-panel';
import { useCreateTableItem, useTableItems } from '../table/hooks';
import { dayTitle, monthGrid, monthStart, monthTitle, weekdayLabels, weekOf } from './calendar-model';
import { colorOf, dateValueOf, dateWritePayload } from './model';
import { useRescheduleItem } from './hooks';
import { useCalendarConfig } from './use-calendar-config';

export interface CalendarViewProps {
  board: BoardDetail;
  view: BoardView;
}

const EMPTY_PARAMS: ItemListParams = {};

export function CalendarView({ board, view }: CalendarViewProps) {
  const t = useTranslations('calendar');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { config, setConfig, canEdit } = useCalendarConfig(board.id, view);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [mode, setMode] = useState<'month' | 'week' | 'day'>(config.defaultView);
  const [cursor, setCursor] = useState(today);

  const query = useTableItems(board, EMPTY_PARAMS);
  const reschedule = useRescheduleItem(board.id);
  const createItem = useCreateTableItem(board);
  const openItem = useOpenItemPanel();

  const dated = useMemo(
    () =>
      query.items
        .map((item) => ({ item, date: dateValueOf(item, config.dateColumnKey) }))
        .filter((entry): entry is { item: Item; date: string } => entry.date !== null),
    [query.items, config.dateColumnKey],
  );
  const itemsByDate = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const { item, date } of dated) map.set(date, [...(map.get(date) ?? []), item]);
    return map;
  }, [dated]);

  const monthStartDate = `${cursor.slice(0, 7)}-01`;
  const weeks = useMemo(
    () => (mode === 'month' ? monthGrid(monthStartDate, today) : []),
    [mode, monthStartDate, today],
  );
  const week = useMemo(() => (mode === 'week' ? weekOf(cursor, today) : []), [mode, cursor, today]);
  const labels = useMemo(() => weekdayLabels(locale), [locale]);

  const title =
    mode === 'day'
      ? dayTitle(cursor, locale)
      : mode === 'week'
        ? `${dayTitle(week[0]?.date ?? cursor, locale)} – ${dayTitle(week[6]?.date ?? cursor, locale)}`
        : monthTitle(monthStartDate, locale);

  const goTo = (direction: -1 | 1) => {
    if (mode === 'month') {
      const [year, month] = monthStartDate.split('-').map(Number) as [number, number];
      setCursor(monthStart(year, month - 1 + direction));
      return;
    }
    setCursor(shiftDays(cursor, mode === 'week' ? direction * 7 : direction));
  };

  const onReschedule = (itemId: string, date: string) => {
    void reschedule.mutateAsync({ itemId, body: dateWritePayload(config.dateColumnKey, date) });
  };

  const onCreate = async (date: string) => {
    if (board.groups[0] === undefined) return;
    const created = await createItem({ groupId: board.groups[0].id, name: t('newItemName') });
    if (created !== null) onReschedule(created.id, date);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null) return;
    onReschedule(String(active.id), String(over.id));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label={t('title')}
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-6"
      >
        <IconButton
          label={t('previous')}
          icon={<ChevronLeft aria-hidden="true" />}
          size="icon-sm"
          onClick={() => {
            goTo(-1);
          }}
        />
        <IconButton
          label={t('next')}
          icon={<ChevronRight aria-hidden="true" />}
          size="icon-sm"
          onClick={() => {
            goTo(1);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCursor(today);
          }}
        >
          {tc('today')}
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold capitalize">{title}</h2>
        <Tabs
          value={mode}
          onValueChange={(value) => {
            const next = value as typeof mode;
            setMode(next);
            if (canEdit) setConfig({ defaultView: next });
          }}
        >
          <TabsList>
            <TabsTrigger value="month">{t('views.month')}</TabsTrigger>
            <TabsTrigger value="week">{t('views.week')}</TabsTrigger>
            <TabsTrigger value="day">{t('views.day')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <DndContext onDragEnd={onDragEnd}>
          {mode === 'month' ? (
            <MonthGrid
              weeks={weeks}
              weekdayLabels={labels}
              itemsByDate={itemsByDate}
              board={board}
              colorBy={config.colorBy}
              canEdit={canEdit}
              onOpenItem={openItem}
              onCreate={(date) => void onCreate(date)}
            />
          ) : (
            <DayColumns
              days={mode === 'week' ? week.map((day) => day.date) : [cursor]}
              dayLabels={
                mode === 'week'
                  ? week.map((day) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' }).format(new Date(`${day.date}T00:00:00Z`)))
                  : [dayTitle(cursor, locale)]
              }
              itemsByDate={itemsByDate}
              board={board}
              colorBy={config.colorBy}
              canEdit={canEdit}
              onOpenItem={openItem}
              onCreate={(date) => void onCreate(date)}
            />
          )}
        </DndContext>
        {query.items.length === 0 && !query.isLoading ? (
          <div className="p-6">
            <EmptyState icon={<CalendarDays aria-hidden="true" />} title={t('empty.title')} description={t('empty.description')} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ItemBadge({
  item,
  color,
  onOpen,
  draggable,
}: {
  item: Item;
  color: string | null;
  onOpen: () => void;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !draggable,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      onClick={onOpen}
      style={
        transform
          ? { transform: `translate(${String(transform.x)}px, ${String(transform.y)}px)`, zIndex: 10 }
          : undefined
      }
      className={cn(
        'flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-start text-xs hover:bg-surface-hover',
        isDragging && 'opacity-50',
      )}
    >
      {color !== null ? (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      ) : null}
      <span className="truncate">{item.isMilestone ? '◆ ' : ''}{item.name}</span>
    </button>
  );
}

function DayCell({
  date,
  inCurrentMonth = true,
  isToday,
  isWeekend,
  label,
  items,
  board,
  colorBy,
  canEdit,
  onOpenItem,
  onCreate,
}: {
  date: string;
  inCurrentMonth?: boolean;
  isToday: boolean;
  isWeekend: boolean;
  label: string;
  items: readonly Item[];
  board: BoardDetail;
  colorBy: string | undefined;
  canEdit: boolean;
  onOpenItem: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const visible = items.slice(0, 4);
  const overflow = items.length - visible.length;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-28 flex-col gap-0.5 border-b border-e border-border p-1',
        !inCurrentMonth && 'bg-surface-subtle text-fg-subtle',
        isWeekend && inCurrentMonth && 'bg-surface-subtle/50',
        isOver && 'bg-primary-soft',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-xs font-medium', isToday && 'flex size-5 items-center justify-center rounded-full bg-primary text-primary-fg')}>
          {label}
        </span>
        {canEdit ? (
          <button
            type="button"
            className="text-xs text-fg-subtle opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => {
              onCreate(date);
            }}
            aria-label={label}
          >
            +
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <ItemBadge
            key={item.id}
            item={item}
            color={colorOf(item, board, colorBy)}
            onOpen={() => {
              onOpenItem(item.id);
            }}
            draggable={canEdit}
          />
        ))}
        {overflow > 0 ? <span className="px-1.5 text-xs text-fg-subtle">+{overflow}</span> : null}
      </div>
    </div>
  );
}

function MonthGrid({
  weeks,
  weekdayLabels: labels,
  itemsByDate,
  board,
  colorBy,
  canEdit,
  onOpenItem,
  onCreate,
}: {
  weeks: ReturnType<typeof monthGrid>;
  weekdayLabels: string[];
  itemsByDate: Map<string, Item[]>;
  board: BoardDetail;
  colorBy: string | undefined;
  canEdit: boolean;
  onOpenItem: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  return (
    <div className="grid grid-cols-7" role="grid">
      {labels.map((label) => (
        <div key={label} className="border-b border-border p-1 text-center text-xs font-semibold capitalize text-fg-muted">
          {label}
        </div>
      ))}
      {weeks.flat().map((day) => (
        <DayCell
          key={day.date}
          date={day.date}
          inCurrentMonth={day.inCurrentMonth}
          isToday={day.isToday}
          isWeekend={day.isWeekend}
          label={day.date.slice(-2)}
          items={itemsByDate.get(day.date) ?? []}
          board={board}
          colorBy={colorBy}
          canEdit={canEdit}
          onOpenItem={onOpenItem}
          onCreate={onCreate}
        />
      ))}
    </div>
  );
}

function DayColumns({
  days,
  dayLabels,
  itemsByDate,
  board,
  colorBy,
  canEdit,
  onOpenItem,
  onCreate,
}: {
  days: string[];
  dayLabels: string[];
  itemsByDate: Map<string, Item[]>;
  board: BoardDetail;
  colorBy: string | undefined;
  canEdit: boolean;
  onOpenItem: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  return (
    <div className={cn('grid h-full', days.length > 1 ? 'grid-cols-7' : 'grid-cols-1')}>
      {days.map((date, index) => (
        <DayCell
          key={date}
          date={date}
          isToday={false}
          isWeekend={false}
          label={dayLabels[index] ?? date}
          items={itemsByDate.get(date) ?? []}
          board={board}
          colorBy={colorBy}
          canEdit={canEdit}
          onOpenItem={onOpenItem}
          onCreate={onCreate}
        />
      ))}
    </div>
  );
}
