'use client';

import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { Badge, EmptyState, Skeleton, Tooltip, cn } from '@cube-track/ui';
import { BarChart3 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Allocation, CapacityHeatmapResponse } from '@/lib/api/types';

import {
  UTILIZATION_CLASSES,
  allocationOn,
  decodeCellId,
  encodeCellId,
  formatHours,
  groupHeatmapRows,
  type HeatmapGroup,
  utilizationLevel,
} from './model';

export interface CapacityHeatmapDnd {
  allocations: readonly Allocation[];
  /** Move o dia inteiro de `fromDate` para `toDate` na alocação que cobre `fromDate`. */
  onMove: (allocation: Allocation, fromDate: string, toDate: string) => void;
}

export interface CapacityHeatmapProps {
  heatmap: CapacityHeatmapResponse | undefined;
  loading: boolean;
  groupBy: 'person' | 'team' | 'skill';
  teamNames: ReadonlyMap<string, string>;
  skillNames: ReadonlyMap<string, string>;
  /** Só habilitado com granularidade diária e agrupamento por pessoa (ADR 0052). */
  dnd?: CapacityHeatmapDnd;
}

function Cell({
  userId,
  date,
  value,
  draggable,
  droppable,
}: {
  userId: string;
  date: string;
  value: { hours: string; level: ReturnType<typeof utilizationLevel> };
  draggable: boolean;
  droppable: boolean;
}) {
  const cellId = encodeCellId(userId, date);
  const drag = useDraggable({ id: cellId, disabled: !draggable || value.hours === '0' });
  const drop = useDroppable({ id: cellId, disabled: !droppable });
  return (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      {...(draggable ? { ...drag.attributes, ...drag.listeners, tabIndex: 0, role: 'button' } : {})}
      style={
        drag.transform
          ? { transform: `translate(${String(drag.transform.x)}px, ${String(drag.transform.y)}px)`, zIndex: 10 }
          : undefined
      }
      className={cn(
        'flex h-9 min-w-14 items-center justify-center rounded border text-xs font-medium',
        UTILIZATION_CLASSES[value.level],
        draggable && value.hours !== '0' && 'cursor-grab active:cursor-grabbing',
        drag.isDragging && 'opacity-50',
        drop.isOver && 'ring-2 ring-primary',
      )}
    >
      {value.hours === '0' ? '·' : value.hours}
    </div>
  );
}

function GroupRow({ group, dnd }: { group: HeatmapGroup; dnd: CapacityHeatmapDnd | undefined }) {
  const canDrag = dnd !== undefined && group.rows.length === 1;
  const userId = group.rows[0]?.userId;
  return (
    <div className="flex items-center gap-1 border-b border-border py-1">
      <div className="w-40 shrink-0 truncate pe-2 text-sm font-medium" title={group.label}>
        {group.label}
      </div>
      <div className="flex flex-1 gap-1 overflow-x-auto">
        {group.totals.map((bucket) => {
          const level = utilizationLevel(bucket);
          const value = { hours: formatHours(bucket.allocatedHours), level };
          const content = (
            <Cell
              key={bucket.bucket}
              userId={userId ?? ''}
              date={bucket.bucket}
              value={value}
              draggable={canDrag && userId !== undefined}
              droppable={canDrag && userId !== undefined}
            />
          );
          return (
            <Tooltip
              key={bucket.bucket}
              content={`${bucket.bucket}: ${formatHours(bucket.allocatedHours)}h / ${formatHours(bucket.availableHours)}h`}
            >
              {content}
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Heatmap de Carga de trabalho/Capacity (ADR 0052): disponível × alocado por pessoa, time ou skill,
 * com sobrealocação (>100%) em vermelho e ociosidade destacada. Arrastar uma célula para outra move o
 * dia inteiro da alocação de origem (só pessoa a pessoa, granularidade diária — ver `planAllocationMove`
 * em `model.ts`).
 */
export function CapacityHeatmap({ heatmap, loading, groupBy, teamNames, skillNames, dnd }: CapacityHeatmapProps) {
  const t = useTranslations('capacity');
  if (loading || heatmap === undefined) return <Skeleton className="h-64" />;
  if (heatmap.rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState icon={<BarChart3 aria-hidden="true" />} title={t('heatmap.empty')} />
      </div>
    );
  }
  const groups = groupHeatmapRows(heatmap.rows, groupBy, teamNames, skillNames);
  const buckets = heatmap.rows[0]?.buckets.map((bucket) => bucket.bucket) ?? [];

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (dnd === undefined || over === null || active.id === over.id) return;
    const from = decodeCellId(String(active.id));
    const to = decodeCellId(String(over.id));
    if (from === null || from.userId !== to?.userId) return;
    const allocation = allocationOn(dnd.allocations, from.userId, from.date);
    if (allocation === undefined) return;
    dnd.onMove(allocation, from.date, to.date);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <span className="flex items-center gap-1">
          <span className={cn('inline-block size-3 rounded border', UTILIZATION_CLASSES.idle)} />
          {t('legend.idle')}
        </span>
        <span className="flex items-center gap-1">
          <span className={cn('inline-block size-3 rounded border', UTILIZATION_CLASSES.normal)} />
          {t('legend.normal')}
        </span>
        <span className="flex items-center gap-1">
          <span className={cn('inline-block size-3 rounded border', UTILIZATION_CLASSES.high)} />
          {t('legend.high')}
        </span>
        <span className="flex items-center gap-1">
          <span className={cn('inline-block size-3 rounded border', UTILIZATION_CLASSES.over)} />
          {t('legend.over')}
        </span>
        {dnd !== undefined ? <Badge tone="neutral">{t('heatmap.dndHint')}</Badge> : null}
      </div>
      <DndContext onDragEnd={onDragEnd}>
        <div className="overflow-x-auto">
          <div className="flex items-center gap-1 border-b border-border pb-1 text-xs font-semibold text-fg-muted">
            <div className="w-40 shrink-0">{t(`groupBy.${groupBy}`)}</div>
            <div className="flex flex-1 gap-1">
              {buckets.map((bucket) => (
                <div key={bucket} className="flex h-9 min-w-14 items-center justify-center">
                  {bucket.slice(5)}
                </div>
              ))}
            </div>
          </div>
          {groups.map((group) => (
            <GroupRow key={group.key} group={group} dnd={dnd} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
