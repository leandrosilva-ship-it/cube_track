'use client';

import { Chart, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Skeleton } from '@cube-track/ui';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Battery,
  CalendarClock,
  Download,
  HeartPulse,
  Hash,
  MoreVertical,
  PieChart,
  Pencil,
  Trash2,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Widget, WidgetData, WidgetType } from '@/lib/api/types';

import { widgetExportUrl } from './hooks';
import { chartBarOption, chartPieOption } from './model';
import { ProjectHealthWidgetBody } from './project-health-widget';

const WIDGET_ICONS: Record<WidgetType, typeof Hash> = {
  number: Hash,
  chart_bar: BarChart3,
  chart_pie: PieChart,
  battery: Battery,
  workload: Users,
  project_health: HeartPulse,
  capacity: CalendarClock,
};

export interface WidgetCardProps {
  widget: Widget;
  data: WidgetData | undefined;
  loading: boolean;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReportHealth: (boardId: string) => void;
}

export function WidgetCard({
  widget,
  data,
  loading,
  canEdit,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onReportHealth,
}: WidgetCardProps) {
  const t = useTranslations('dashboards');
  const Icon = WIDGET_ICONS[widget.type];
  const gridColumn = `span ${widget.layout.w} / span ${widget.layout.w}`;
  const gridRow = `span ${widget.layout.h} / span ${widget.layout.h}`;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-xs"
      style={{ gridColumn, gridRow }}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{widget.title}</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="sm"
              variant="ghost"
              label={t('widgetMenu.open')}
              icon={<MoreVertical className="size-4" aria-hidden="true" />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit ? (
              <DropdownMenuItem icon={<Pencil className="size-4" aria-hidden="true" />} onSelect={onEdit}>
                {t('widgetMenu.edit')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <a href={widgetExportUrl(widget.id)} download>
                <Download className="size-4" aria-hidden="true" />
                {t('widgetMenu.exportCsv')}
              </a>
            </DropdownMenuItem>
            {canEdit && !isFirst ? (
              <DropdownMenuItem icon={<ArrowUp className="size-4" aria-hidden="true" />} onSelect={onMoveUp}>
                {t('widgetMenu.moveUp')}
              </DropdownMenuItem>
            ) : null}
            {canEdit && !isLast ? (
              <DropdownMenuItem icon={<ArrowDown className="size-4" aria-hidden="true" />} onSelect={onMoveDown}>
                {t('widgetMenu.moveDown')}
              </DropdownMenuItem>
            ) : null}
            {canEdit ? (
              <DropdownMenuItem destructive icon={<Trash2 className="size-4" aria-hidden="true" />} onSelect={onDelete}>
                {t('widgetMenu.delete')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1">
        {loading || data === undefined ? (
          <Skeleton className="h-full min-h-16 w-full" />
        ) : (
          <WidgetBody
            type={widget.type}
            title={widget.title}
            data={data}
            onReportHealth={() => {
              const boardId = widget.config.boardId;
              if (typeof boardId === 'string') onReportHealth(boardId);
            }}
          />
        )}
      </div>
    </div>
  );
}

function WidgetBody({
  type,
  title,
  data,
  onReportHealth,
}: {
  type: WidgetType;
  title: string;
  data: WidgetData;
  onReportHealth: () => void;
}) {
  const t = useTranslations('dashboards');
  switch (data.kind) {
    case 'number':
      return (
        <div className="flex h-full items-center justify-center">
          <p className="text-4xl font-semibold tabular-nums">{data.value ?? '—'}</p>
        </div>
      );
    case 'chart':
      if (data.categories.length === 0) return <EmptyBody message={t('widgetMenu.noData')} />;
      return (
        <Chart
          ariaLabel={title}
          height="100%"
          option={type === 'chart_pie' ? chartPieOption(data) : chartBarOption(data)}
        />
      );
    case 'battery':
      return <BatteryBody data={data} />;
    case 'workload':
      return <WorkloadBody data={data} />;
    case 'project_health':
      return <ProjectHealthWidgetBody data={data} onReport={onReportHealth} />;
    case 'capacity':
      return <CapacityBody data={data} />;
  }
}

function BatteryBody({ data }: { data: Extract<WidgetData, { kind: 'battery' }> }) {
  const t = useTranslations('dashboards');
  const segments: { key: string; label: string; value: number; color: string }[] = [
    { key: 'onTime', label: t('battery.onTime'), value: data.onTime, color: '#00c875' },
    { key: 'replanned', label: t('battery.replanned'), value: data.replanned, color: '#ffcb00' },
    { key: 'late', label: t('battery.late'), value: data.late, color: '#df2f4a' },
    { key: 'noDate', label: t('battery.noDate'), value: data.noDate, color: '#c4c4c4' },
  ];
  const total = data.total === 0 ? 1 : data.total;
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-surface-subtle">
        {segments.map((segment) =>
          segment.value === 0 ? null : (
            <div
              key={segment.key}
              style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }}
              title={`${segment.label}: ${segment.value}`}
            />
          ),
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: segment.color }}
              aria-hidden="true"
            />
            {segment.label}: {segment.value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorkloadBody({ data }: { data: Extract<WidgetData, { kind: 'workload' }> }) {
  const t = useTranslations('dashboards');
  if (data.people.length === 0) return <EmptyBody message={t('widgetMenu.noData')} />;
  const max = Math.max(...data.people.map((entry) => entry.value), 1);
  return (
    <ul className="flex h-full flex-col justify-center gap-2 overflow-y-auto">
      {data.people.map((entry) => (
        <li key={entry.personId} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate" title={entry.personName}>
            {entry.personName}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(entry.value / max) * 100}%` }}
            />
          </div>
          <span className="w-10 shrink-0 text-right tabular-nums">{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}

function bucketColor(bucket: { utilization: number; overallocated: boolean; nominalHours: number }): string {
  if (bucket.overallocated) return '#df2f4a';
  if (bucket.nominalHours === 0) return 'transparent';
  if (bucket.utilization === 0) return '#c4c4c4';
  if (bucket.utilization >= 0.85) return '#ffcb00';
  return '#00c875';
}

function CapacityBody({ data }: { data: Extract<WidgetData, { kind: 'capacity' }> }) {
  const t = useTranslations('dashboards');
  if (data.rows.length === 0) return <EmptyBody message={t('widgetMenu.noData')} />;
  return (
    <ul className="flex h-full flex-col justify-center gap-2 overflow-y-auto">
      {data.rows.map((row) => (
        <li key={row.userId} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 truncate" title={row.userName}>
            {row.userName}
          </span>
          <div className="flex flex-1 gap-0.5">
            {row.buckets.map((bucket) => (
              <span
                key={bucket.bucket}
                className="h-4 flex-1 rounded-xs"
                style={{ backgroundColor: bucketColor(bucket) }}
                title={`${bucket.bucket}: ${Math.round(bucket.utilization * 100)}%`}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyBody({ message }: { message: string }) {
  return <p className="flex h-full items-center justify-center text-xs text-fg-subtle">{message}</p>;
}
