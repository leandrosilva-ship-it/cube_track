'use client';

import {
  buildTicks,
  dateToX,
  defaultRange,
  durationPx,
  shiftDays,
  ZOOM_PX_PER_DAY,
  type TimeZoom,
} from '@cube-track/shared';
import {
  cn,
  EmptyState,
  Field,
  IconButton,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  readableTextOn,
  Select,
  Switch,
} from '@cube-track/ui';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { GanttChartSquare, Settings2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef } from 'react';

import type { BoardDetail, BoardView } from '@/lib/api/types';
import type { ItemListParams } from '@/lib/query/keys';

import { useOpenItemPanel } from '../collaboration/use-open-item-panel';
import { KANBAN_FIELD_TYPES, type KanbanLabels } from '../kanban/model';
import { useMembers } from '../shell/hooks';
import { useTableItems } from '../table/hooks';
import { GROUP_LEVEL_GROUP } from '../table/model';
import { useRescheduleItem } from './hooks';
import { colorOf, dateColumnsOf, NATIVE_DATE_FIELD_KEYS, rangeWritePayload } from './model';
import { timelineRows, timelineTasksOf, type TimelineTask } from './timeline-model';
import { useTimelineConfig } from './use-timeline-config';

export interface TimelineViewProps {
  board: BoardDetail;
  view: BoardView;
}

const EMPTY_PARAMS: ItemListParams = {};
const LABEL_WIDTH = 176;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 32;

/** View Timeline/Roadmap: barras por coluna de datas, agrupadas, com marcos e linha do hoje. */
export function TimelineView({ board, view }: TimelineViewProps) {
  const t = useTranslations('timeline');
  const tp = useTranslations('planning');
  const locale = useLocale();
  const { config, setConfig, canEdit } = useTimelineConfig(board.id, view);
  const members = useMembers();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const query = useTableItems(board, EMPTY_PARAMS);
  const reschedule = useRescheduleItem(board.id);
  const openItem = useOpenItemPanel();
  const scrollRef = useRef<HTMLDivElement>(null);

  const tasks = useMemo(
    () => timelineTasksOf(query.items, config),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só start/endColumnKey afetam o resultado
    [query.items, config.startColumnKey, config.endColumnKey],
  );
  const labels = useMemo<KanbanLabels>(
    () => ({
      none: tp('none'),
      checked: tp('none'),
      unchecked: tp('none'),
      person: (id: string) => members.data?.find((member) => member.userId === id)?.name ?? id,
    }),
    [members.data, tp],
  );
  const rows = useMemo(
    () => timelineRows(board, tasks, config.groupBy, labels),
    [board, tasks, config.groupBy, labels],
  );

  const pxPerDay = ZOOM_PX_PER_DAY[config.zoom];
  const range = useMemo(() => defaultRange(tasks, 14, today), [tasks, today]);
  const ticks = useMemo(() => buildTicks(range, config.zoom, locale), [range, config.zoom, locale]);
  const totalWidth = dateToX(range.end, range.start, pxPerDay) + pxPerDay;
  const todayX = dateToX(today, range.start, pxPerDay);

  const fieldColumns = useMemo(
    () => board.columns.filter((column) => KANBAN_FIELD_TYPES.has(column.type)),
    [board.columns],
  );
  const groupByOptions = [
    { value: GROUP_LEVEL_GROUP, label: tp('group') },
    ...fieldColumns.map((column) => ({ value: column.key, label: column.title })),
  ];
  const colorByOptions = [
    { value: '', label: tp('none') },
    ...fieldColumns.map((column) => ({ value: column.key, label: column.title })),
  ];
  const dateFieldOptions = useMemo(
    () => [
      ...NATIVE_DATE_FIELD_KEYS.map((key) => ({ value: key, label: tp(`nativeFields.${key}`) })),
      ...dateColumnsOf(board).map((column) => ({ value: column.key, label: column.title })),
    ],
    [board, tp],
  );

  const goToday = () => {
    const node = scrollRef.current;
    if (node === null) return;
    node.scrollTo({ left: Math.max(0, todayX + LABEL_WIDTH - node.clientWidth / 2) });
  };

  const onMove = (itemId: string, task: TimelineTask, deltaDays: number) => {
    if (deltaDays === 0) return;
    const start = shiftDays(task.start, deltaDays);
    const end = shiftDays(task.end, deltaDays);
    void reschedule.mutateAsync({
      itemId,
      body: rangeWritePayload(config.startColumnKey, config.endColumnKey, start, end),
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const tasksByItemId = useMemo(() => new Map(tasks.map((task) => [task.item.id, task])), [tasks]);

  const onDragEnd = ({ active, delta }: DragEndEvent) => {
    const task = tasksByItemId.get(String(active.id));
    if (task === undefined) return;
    onMove(task.item.id, task, Math.round(delta.x / pxPerDay));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label={t('title')}
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-6"
      >
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <button
          type="button"
          className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-hover"
          onClick={goToday}
        >
          {t('today')}
        </button>
        <div className="flex-1" />
        <Select
          aria-label={t('zoom')}
          value={config.zoom}
          options={(['day', 'week', 'month', 'quarter', 'year'] as const).map((zoom) => ({
            value: zoom,
            label: tp(`zooms.${zoom}`),
          }))}
          className="w-32"
          onValueChange={(value) => {
            if (canEdit) setConfig({ zoom: value as TimeZoom });
          }}
        />
        {canEdit ? (
          <Popover>
            <PopoverTrigger asChild>
              <IconButton label={t('settings.title')} icon={<Settings2 aria-hidden="true" />} size="icon-sm" />
            </PopoverTrigger>
            <PopoverContent aria-label={t('settings.title')} className="w-80" align="end">
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{t('settings.title')}</h3>
                  <p className="text-xs text-fg-muted">{t('settings.description')}</p>
                </div>
                <Field label={t('settings.groupBy')}>
                  <Select
                    value={config.groupBy}
                    options={groupByOptions}
                    onValueChange={(value) => {
                      setConfig({ groupBy: value });
                    }}
                  />
                </Field>
                <Field label={t('settings.colorBy')}>
                  <Select
                    value={config.colorBy ?? ''}
                    options={colorByOptions}
                    onValueChange={(value) => {
                      setConfig({ colorBy: value === '' ? undefined : value });
                    }}
                  />
                </Field>
                <Field label={t('settings.startColumn')}>
                  <Select
                    value={config.startColumnKey}
                    options={dateFieldOptions}
                    onValueChange={(value) => {
                      setConfig({ startColumnKey: value });
                    }}
                  />
                </Field>
                <Field label={t('settings.endColumn')}>
                  <Select
                    value={config.endColumnKey}
                    options={dateFieldOptions}
                    onValueChange={(value) => {
                      setConfig({ endColumnKey: value });
                    }}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Switch
                    id="ct-timeline-milestones"
                    checked={config.showMilestones}
                    onCheckedChange={(checked) => {
                      setConfig({ showMilestones: checked });
                    }}
                  />
                  <Label htmlFor="ct-timeline-milestones">{t('settings.showMilestones')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="ct-timeline-today"
                    checked={config.showToday}
                    onCheckedChange={(checked) => {
                      setConfig({ showToday: checked });
                    }}
                  />
                  <Label htmlFor="ct-timeline-today">{t('settings.showToday')}</Label>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      {tasks.length === 0 && !query.isLoading ? (
        <div className="p-6">
          <EmptyState icon={<GanttChartSquare aria-hidden="true" />} title={t('empty.title')} description={t('empty.description')} />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div style={{ width: LABEL_WIDTH + totalWidth, minWidth: '100%' }}>
              <div className="flex" style={{ height: HEADER_HEIGHT }}>
                <div
                  className="sticky left-0 z-20 shrink-0 border-b border-e border-border bg-surface"
                  style={{ width: LABEL_WIDTH }}
                />
                <div className="relative shrink-0" style={{ width: totalWidth, height: HEADER_HEIGHT }}>
                  {ticks.map((tick) => (
                    <div
                      key={tick.date}
                      className={cn(
                        'absolute top-0 h-full border-s ps-1 pt-1 text-xs capitalize',
                        tick.major ? 'border-border-strong font-semibold text-fg' : 'border-border text-fg-muted',
                      )}
                      style={{ left: dateToX(tick.date, range.start, pxPerDay) }}
                    >
                      {tick.label}
                    </div>
                  ))}
                  {config.showToday ? (
                    <div className="absolute top-0 h-full w-px bg-danger" style={{ left: todayX }} />
                  ) : null}
                </div>
              </div>
              {rows.map((row) => (
                <div key={row.key} className="flex">
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-e border-border bg-surface px-2"
                    style={{ width: LABEL_WIDTH, height: ROW_HEIGHT }}
                  >
                    {row.color !== '' ? (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span className="truncate text-xs font-medium">{row.label}</span>
                  </div>
                  <div
                    className="relative shrink-0 border-b border-border"
                    style={{ width: totalWidth, height: ROW_HEIGHT }}
                  >
                    {config.showToday ? (
                      <div className="absolute top-0 h-full w-px bg-danger/30" style={{ left: todayX }} />
                    ) : null}
                    {row.tasks.map((task) => (
                      <TimelineBar
                        key={task.item.id}
                        task={task}
                        color={colorOf(task.item, board, config.colorBy)}
                        rangeStart={range.start}
                        pxPerDay={pxPerDay}
                        showMilestone={config.showMilestones}
                        draggable={canEdit}
                        onOpen={() => {
                          openItem(task.item.id);
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </DndContext>
        </div>
      )}
    </div>
  );
}

function TimelineBar({
  task,
  color,
  rangeStart,
  pxPerDay,
  showMilestone,
  draggable,
  onOpen,
}: {
  task: TimelineTask;
  color: string | null;
  rangeStart: string;
  pxPerDay: number;
  showMilestone: boolean;
  draggable: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.item.id,
    disabled: !draggable,
  });
  const left = dateToX(task.start, rangeStart, pxPerDay);
  const translate = transform ? `translateX(${String(transform.x)}px)` : undefined;
  const background = color ?? '#4252d9';
  const textColor = readableTextOn(background);

  if (task.item.isMilestone && showMilestone) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        onClick={onOpen}
        className={cn(
          'absolute top-1/2 size-3 -translate-y-1/2 rotate-45 border border-border-strong focus-visible:ring-2 focus-visible:ring-primary',
          isDragging && 'opacity-50',
        )}
        style={{ left: left - 6, backgroundColor: background, transform: translate }}
        aria-label={task.item.name}
        title={task.item.name}
      />
    );
  }

  const width = Math.max(pxPerDay, durationPx(task.start, task.end, pxPerDay));
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      onClick={onOpen}
      className={cn(
        'absolute top-1.5 flex items-center truncate rounded px-1.5 text-start text-xs shadow-sm hover:brightness-95 focus-visible:ring-2 focus-visible:ring-primary',
        isDragging && 'opacity-50',
      )}
      style={{
        left,
        width,
        height: ROW_HEIGHT - 12,
        backgroundColor: background,
        color: textColor,
        transform: translate,
      }}
      title={task.item.name}
    >
      <span className="truncate">{task.item.name}</span>
    </button>
  );
}
