'use client';

import {
  buildTicks,
  dateToX,
  defaultRange,
  durationPx,
  ZOOM_PX_PER_DAY,
  type TimeZoom,
} from '@cube-track/shared';
import {
  cn,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
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
import {
  Diamond,
  FileDown,
  Flag,
  GanttChartSquare,
  History,
  Image as ImageIcon,
  Lock,
  LockOpen,
  MoreHorizontal,
  Settings2,
  Upload,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useMemo, useRef, useState } from 'react';

import type { BoardDetail, BoardView, GanttTask } from '@/lib/api/types';

import { useOpenItemPanel } from '../collaboration/use-open-item-panel';
import { BaselinesDialog } from './baselines-dialog';
import { dependencyConnectors, ganttRows, type GanttRow } from './gantt-model';
import { useBaselineDetail, useGanttData, useMilestones, usePatchGanttItem } from './hooks';
import { MilestonesDialog } from './milestones-dialog';
import { ScheduleImportDialog } from './schedule-import-dialog';
import { useGanttConfig } from './use-gantt-config';

export interface GanttViewProps {
  board: BoardDetail;
  view: BoardView;
}

const LABEL_WIDTH = 288;
const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 32;
const INDENT = 16;

/** View Gantt/Cronograma: EAP, barras, dependências (FS/SS/FF/SF) e caminho crítico (ADR 0049). */
export function GanttView({ board, view }: GanttViewProps) {
  const t = useTranslations('gantt');
  const tp = useTranslations('planning');
  const locale = useLocale();
  const { config, setConfig, canEdit } = useGanttConfig(board.id, view);
  const query = useGanttData(board.id);
  const patch = usePatchGanttItem(board.id);
  const openItem = useOpenItemPanel();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [milestonesOpen, setMilestonesOpen] = useState(false);
  const [baselinesOpen, setBaselinesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [comparingBaselineId, setComparingBaselineId] = useState<string | null>(null);
  const baselineDetail = useBaselineDetail(comparingBaselineId);
  const baselineRowsById = useMemo(
    () => new Map((baselineDetail.data?.items ?? []).map((row) => [row.itemId, row])),
    [baselineDetail.data],
  );
  const milestonesQuery = useMilestones(board.id);
  const milestones = milestonesQuery.data ?? [];

  const tasks = useMemo(() => query.data?.tasks ?? [], [query.data]);
  const dependencies = useMemo(() => query.data?.dependencies ?? [], [query.data]);
  const criticalPath = useMemo(() => query.data?.criticalPath ?? [], [query.data]);
  const criticalById = useMemo(
    () => new Map(criticalPath.map((entry) => [entry.id, entry])),
    [criticalPath],
  );

  const rows = useMemo(
    () => ganttRows(tasks, board.groups, config.groupBy === 'group'),
    [tasks, board.groups, config.groupBy],
  );
  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.task !== undefined) map.set(row.task.id, index);
    });
    return map;
  }, [rows]);
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const pxPerDay = ZOOM_PX_PER_DAY[config.zoom];
  const dated = useMemo(
    () => tasks.map((task) => ({ start: task.start, end: task.end })),
    [tasks],
  );
  const range = useMemo(() => defaultRange(dated, 14, today), [dated, today]);
  const ticks = useMemo(() => buildTicks(range, config.zoom, locale), [range, config.zoom, locale]);
  const totalWidth = dateToX(range.end, range.start, pxPerDay) + pxPerDay;
  const todayX = dateToX(today, range.start, pxPerDay);
  const chartHeight = rows.length * ROW_HEIGHT;

  const connectors = useMemo(
    () =>
      dependencyConnectors(
        dependencies,
        tasksById,
        rowIndexById,
        criticalPath,
        range.start,
        pxPerDay,
        ROW_HEIGHT,
        dateToX,
      ),
    [dependencies, tasksById, rowIndexById, criticalPath, range.start, pxPerDay],
  );

  const goToday = () => {
    const node = scrollRef.current;
    if (node === null) return;
    node.scrollTo({ left: Math.max(0, todayX + LABEL_WIDTH - node.clientWidth / 2) });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = ({ active, delta }: DragEndEvent) => {
    const task = tasksById.get(String(active.id));
    if (task === undefined) return;
    const deltaDays = Math.round(delta.x / pxPerDay);
    if (deltaDays === 0) return;
    const shift = (date: string): string => {
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + deltaDays);
      return next.toISOString().slice(0, 10);
    };
    const fields: { plannedStartDate?: string; plannedEndDate?: string } = {};
    if (task.plannedStartDate !== null) fields.plannedStartDate = shift(task.plannedStartDate);
    if (task.plannedEndDate !== null) fields.plannedEndDate = shift(task.plannedEndDate);
    if (Object.keys(fields).length === 0) return;
    void patch.mutateAsync({ itemId: task.id, patch: { fields } });
  };

  const toggleMilestone = (task: GanttTask) => {
    void patch.mutateAsync({ itemId: task.id, patch: { isMilestone: !task.isMilestone } });
  };

  const toggleScheduleMode = (task: GanttTask) => {
    void patch.mutateAsync({
      itemId: task.id,
      patch: { scheduleMode: task.scheduleMode === 'auto' ? 'manual' : 'auto' },
    });
  };

  const exportPng = async () => {
    const node = chartRef.current;
    if (node === null) return;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `${board.name}-gantt.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const exportPdf = async () => {
    const node = chartRef.current;
    if (node === null) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff' });
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'l' : 'p',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${board.name}-gantt.pdf`);
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
                    options={[
                      { value: 'group', label: t('settings.groupByGroup') },
                      { value: 'none', label: t('settings.groupByNone') },
                    ]}
                    onValueChange={(value) => {
                      setConfig({ groupBy: value === 'none' ? 'none' : 'group' });
                    }}
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <Switch
                    id="ct-gantt-wbs"
                    checked={config.showWbs}
                    onCheckedChange={(checked) => {
                      setConfig({ showWbs: checked });
                    }}
                  />
                  <Label htmlFor="ct-gantt-wbs">{t('settings.showWbs')}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="ct-gantt-critical"
                    checked={config.showCriticalPath}
                    onCheckedChange={(checked) => {
                      setConfig({ showCriticalPath: checked });
                    }}
                  />
                  <Label htmlFor="ct-gantt-critical">{t('settings.showCriticalPath')}</Label>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t('menu.more')} icon={<MoreHorizontal aria-hidden="true" />} size="icon-sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              icon={<Flag aria-hidden="true" />}
              onSelect={() => {
                setMilestonesOpen(true);
              }}
            >
              {t('menu.milestones')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<History aria-hidden="true" />}
              onSelect={() => {
                setBaselinesOpen(true);
              }}
            >
              {t('menu.baselines')}
            </DropdownMenuItem>
            {canEdit ? (
              <DropdownMenuItem
                icon={<Upload aria-hidden="true" />}
                onSelect={() => {
                  setImportOpen(true);
                }}
              >
                {t('menu.import')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<ImageIcon aria-hidden="true" />}
              onSelect={() => {
                void exportPng();
              }}
            >
              {t('menu.exportPng')}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<FileDown aria-hidden="true" />}
              onSelect={() => {
                void exportPdf();
              }}
            >
              {t('menu.exportPdf')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {rows.length === 0 && !query.isLoading ? (
        <div className="p-6">
          <EmptyState icon={<GanttChartSquare aria-hidden="true" />} title={t('empty.title')} description={t('empty.description')} />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div ref={chartRef} style={{ width: LABEL_WIDTH + totalWidth, minWidth: '100%' }}>
              <div className="flex" style={{ height: HEADER_HEIGHT }}>
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-end gap-2 border-b border-e border-border bg-surface px-2 pb-1 text-xs font-semibold text-fg-muted"
                  style={{ width: LABEL_WIDTH }}
                >
                  {config.showWbs ? <span className="w-12 shrink-0">{t('columns.wbs')}</span> : null}
                  <span>{t('columns.name')}</span>
                </div>
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
                  <div className="absolute top-0 h-full w-px bg-danger" style={{ left: todayX }} />
                  {milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="absolute bottom-0 size-2.5 -translate-x-1/2 rotate-45 border border-fg-subtle bg-surface"
                      style={{ left: dateToX(milestone.dueDate, range.start, pxPerDay) }}
                      title={milestone.name}
                    />
                  ))}
                </div>
              </div>
              <div className="relative">
                {rows.map((row) => {
                  const task = row.task;
                  return (
                    <GanttRowView
                      key={row.key}
                      row={row}
                      labelWidth={LABEL_WIDTH}
                      totalWidth={totalWidth}
                      showWbs={config.showWbs}
                      onOpen={task === undefined ? undefined : () => { openItem(task.id); }}
                      onToggleMilestone={
                        task === undefined || !canEdit ? undefined : () => { toggleMilestone(task); }
                      }
                      onToggleScheduleMode={
                        task === undefined || !canEdit ? undefined : () => { toggleScheduleMode(task); }
                      }
                      t={t}
                    />
                  );
                })}
                <div
                  className="pointer-events-none absolute top-0 border-e border-border"
                  style={{ left: LABEL_WIDTH, width: totalWidth, height: chartHeight }}
                >
                  <div className="absolute top-0 h-full w-px bg-danger/30" style={{ left: todayX }} />
                  {milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className="absolute top-0 h-full w-px border-s border-dashed border-fg-subtle"
                      style={{ left: dateToX(milestone.dueDate, range.start, pxPerDay) }}
                      title={milestone.name}
                    />
                  ))}
                  <svg
                    className="absolute left-0 top-0 overflow-visible"
                    width={totalWidth}
                    height={chartHeight}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker id="ct-gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" className="fill-fg-muted" />
                      </marker>
                      <marker id="ct-gantt-arrow-critical" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" className="fill-danger" />
                      </marker>
                    </defs>
                    {connectors.map((connector) => (
                      <path
                        key={connector.id}
                        d={connector.path}
                        fill="none"
                        className={
                          config.showCriticalPath && connector.critical
                            ? 'stroke-danger'
                            : 'stroke-fg-muted'
                        }
                        strokeWidth={1.5}
                        markerEnd={
                          config.showCriticalPath && connector.critical
                            ? 'url(#ct-gantt-arrow-critical)'
                            : 'url(#ct-gantt-arrow)'
                        }
                      />
                    ))}
                  </svg>
                  {rows.map((row, index) => {
                    if (row.task === undefined) return null;
                    const critical = criticalById.get(row.task.id)?.isCritical ?? false;
                    const baseline = baselineRowsById.get(row.task.id);
                    const baselineStart = baseline?.baselineStartDate ?? null;
                    const baselineEnd = baseline?.baselineEndDate ?? null;
                    return (
                      <Fragment key={row.task.id}>
                        {comparingBaselineId !== null && baselineStart !== null && baselineEnd !== null ? (
                          <div
                            className="absolute rounded-sm border border-dashed border-fg-subtle bg-surface-subtle"
                            style={{
                              left: dateToX(baselineStart, range.start, pxPerDay),
                              top: index * ROW_HEIGHT + ROW_HEIGHT - 8,
                              width: Math.max(pxPerDay, durationPx(baselineStart, baselineEnd, pxPerDay)),
                              height: 4,
                            }}
                            title={baseline?.itemName}
                          />
                        ) : null}
                        <GanttBar
                          task={row.task}
                          top={index * ROW_HEIGHT}
                          rangeStart={range.start}
                          pxPerDay={pxPerDay}
                          critical={config.showCriticalPath && critical}
                          draggable={canEdit}
                        />
                      </Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </DndContext>
        </div>
      )}
      <Dialog open={milestonesOpen} onOpenChange={setMilestonesOpen}>
        {milestonesOpen ? (
          <MilestonesDialog
            boardId={board.id}
            canEdit={canEdit}
            onClose={() => {
              setMilestonesOpen(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={baselinesOpen} onOpenChange={setBaselinesOpen}>
        {baselinesOpen ? (
          <BaselinesDialog
            boardId={board.id}
            canEdit={canEdit}
            comparingId={comparingBaselineId}
            onCompare={setComparingBaselineId}
            onClose={() => {
              setBaselinesOpen(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        {importOpen ? (
          <ScheduleImportDialog
            board={board}
            onClose={() => {
              setImportOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function GanttRowView({
  row,
  labelWidth,
  totalWidth,
  showWbs,
  onOpen,
  onToggleMilestone,
  onToggleScheduleMode,
  t,
}: {
  row: GanttRow;
  labelWidth: number;
  totalWidth: number;
  showWbs: boolean;
  onOpen: (() => void) | undefined;
  onToggleMilestone: (() => void) | undefined;
  onToggleScheduleMode: (() => void) | undefined;
  t: ReturnType<typeof useTranslations<'gantt'>>;
}) {
  if (row.type === 'group') {
    return (
      <div className="flex" style={{ height: ROW_HEIGHT }}>
        <div
          className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-e border-border bg-surface-subtle px-2"
          style={{ width: labelWidth }}
        >
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.groupColor }} aria-hidden="true" />
          <span className="truncate text-xs font-semibold">{row.groupName}</span>
        </div>
        <div className="shrink-0 border-b border-border bg-surface-subtle" style={{ width: totalWidth }} />
      </div>
    );
  }

  const task = row.task;
  if (task === undefined) return null;
  return (
    <div className="flex" style={{ height: ROW_HEIGHT }}>
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-b border-e border-border bg-surface px-2"
        style={{ width: labelWidth }}
      >
        {showWbs ? <span className="w-12 shrink-0 truncate text-xs text-fg-muted">{task.wbs}</span> : null}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-start text-xs hover:underline"
          style={{ paddingInlineStart: row.depth * INDENT }}
        >
          {task.name}
        </button>
        {onToggleMilestone ? (
          <button
            type="button"
            onClick={onToggleMilestone}
            aria-label={task.isMilestone ? t('milestone.markOff') : t('milestone.markOn')}
            title={task.isMilestone ? t('milestone.markOff') : t('milestone.markOn')}
            className={cn(
              'shrink-0 rounded p-0.5 hover:bg-surface-hover',
              task.isMilestone ? 'text-primary' : 'text-fg-subtle',
            )}
          >
            <Diamond className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {onToggleScheduleMode ? (
          <button
            type="button"
            onClick={onToggleScheduleMode}
            aria-label={task.scheduleMode === 'auto' ? t('scheduleMode.switchToManual') : t('scheduleMode.switchToAuto')}
            title={task.scheduleMode === 'auto' ? t('scheduleMode.auto') : t('scheduleMode.manual')}
            className="shrink-0 rounded p-0.5 text-fg-subtle hover:bg-surface-hover"
          >
            {task.scheduleMode === 'manual' ? (
              <Lock className="size-3.5" aria-hidden="true" />
            ) : (
              <LockOpen className="size-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      <div className="shrink-0 border-b border-border" style={{ width: totalWidth }} />
    </div>
  );
}

function GanttBar({
  task,
  top,
  rangeStart,
  pxPerDay,
  critical,
  draggable,
}: {
  task: GanttTask;
  top: number;
  rangeStart: string;
  pxPerDay: number;
  critical: boolean;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !draggable,
  });
  if (task.start === null) return null;
  // Sem término planejado ainda, mostra uma barra de um dia (mesma convenção da Timeline) em vez de
  // esconder a tarefa — o usuário arrasta a borda certa depois de ver onde ela está.
  const end = task.end ?? task.start;
  const left = dateToX(task.start, rangeStart, pxPerDay);
  const translate = transform ? `translateX(${String(transform.x)}px)` : undefined;
  const barTop = top + 6;
  const barHeight = ROW_HEIGHT - 12;
  const progress = task.progress === null ? null : Math.min(100, Math.max(0, Number(task.progress)));

  if (task.isMilestone) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        className={cn(
          'absolute size-3.5 rotate-45 border focus-visible:ring-2 focus-visible:ring-primary',
          critical ? 'border-danger bg-danger' : 'border-primary bg-primary',
          isDragging && 'opacity-50',
        )}
        style={{ left: left - 7, top: top + ROW_HEIGHT / 2 - 7, transform: translate }}
        aria-label={`${task.name} (${task.start})`}
        title={task.name}
      />
    );
  }

  const width = Math.max(pxPerDay, durationPx(task.start, end, pxPerDay));
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
      className={cn(
        'absolute flex items-center overflow-hidden truncate rounded text-start text-xs text-primary-fg shadow-sm focus-visible:ring-2 focus-visible:ring-primary',
        critical ? 'bg-danger' : 'bg-primary',
        task.scheduleMode === 'manual' && 'outline outline-2 outline-offset-1 outline-dashed outline-fg-subtle',
        isDragging && 'opacity-50',
        !draggable && 'cursor-default',
      )}
      style={{ left, top: barTop, width, height: barHeight, transform: translate }}
      aria-label={`${task.name} (${task.start} → ${end})`}
      title={task.name}
    >
      {progress !== null ? (
        <span className="absolute inset-y-0 left-0 bg-black/20" style={{ width: `${String(progress)}%` }} aria-hidden="true" />
      ) : null}
      <span className="relative truncate px-1.5" aria-hidden="true">
        {task.name}
      </span>
    </button>
  );
}
