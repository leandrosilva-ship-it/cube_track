import type { TimelineConfig } from '@cube-track/shared';

import type { BoardDetail, Item } from '@/lib/api/types';

import { kanbanBucketsFor, kanbanKeyOf, type KanbanLabels } from '../kanban/model';
import { dateValueOf } from './model';

export interface TimelineTask {
  item: Item;
  start: string;
  end: string;
}

/**
 * Tarefas com data configurada (início e/ou fim) — sem nenhuma das duas, o item não aparece na
 * Timeline. Quando só uma ponta está preenchida, a outra assume o mesmo dia (barra de um dia).
 */
export function timelineTasksOf(items: readonly Item[], config: TimelineConfig): TimelineTask[] {
  const tasks: TimelineTask[] = [];
  for (const item of items) {
    const start = dateValueOf(item, config.startColumnKey);
    const end = dateValueOf(item, config.endColumnKey);
    if (start !== null && end !== null) tasks.push({ item, start, end });
    else if (start !== null) tasks.push({ item, start, end: start });
    else if (end !== null) tasks.push({ item, start: end, end });
  }
  return tasks;
}

export interface TimelineRow {
  key: string;
  label: string;
  color: string;
  tasks: TimelineTask[];
}

/** Agrupa as tarefas por `groupBy` — mesmos buckets do Kanban (grupo do board ou coluna). */
export function timelineRows(
  board: BoardDetail,
  tasks: readonly TimelineTask[],
  groupBy: string,
  labels: KanbanLabels,
): TimelineRow[] {
  const items = tasks.map((task) => task.item);
  const byItemId = new Map(tasks.map((task) => [task.item.id, task]));
  return kanbanBucketsFor(board, groupBy, items, labels, true).map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    color: bucket.color,
    tasks: items
      .filter((item) => kanbanKeyOf(board, item, groupBy) === bucket.key)
      .map((item) => byItemId.get(item.id))
      .filter((task): task is TimelineTask => task !== undefined),
  }));
}
