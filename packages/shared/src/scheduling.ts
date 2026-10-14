import {
  addBusinessDays,
  alignToBusinessDay,
  businessDaysBetween,
  type WorkingCalendar,
} from './business-days.js';

/**
 * Recálculo de cronograma por dependências (passagem para frente, "empurra, não puxa").
 *
 * Regras (lag em dias úteis, pode ser negativo):
 * - FS: início do sucessor ≥ fim do predecessor + 1 + lag
 * - SS: início do sucessor ≥ início do predecessor + lag
 * - FF: fim do sucessor ≥ fim do predecessor + lag
 * - SF: fim do sucessor ≥ início do predecessor + lag
 * A duração (dias úteis) de cada tarefa é preservada. Datas só avançam: planos manuais mais
 * tardios são respeitados. Ciclos são detectados e as tarefas envolvidas não são alteradas.
 */

export type DependencyKind = 'FS' | 'SS' | 'FF' | 'SF';

export interface ScheduleTask {
  id: string;
  start: string | null;
  end: string | null;
}

export interface ScheduleLink {
  predecessorId: string;
  successorId: string;
  type: DependencyKind;
  lagDays: number;
}

export interface ScheduleChange {
  id: string;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
}

export interface ScheduleResult {
  changes: ScheduleChange[];
  /** Tarefas em ciclos de dependência (não recalculadas). */
  cyclic: string[];
}

export function computeSchedule(
  tasks: readonly ScheduleTask[],
  links: readonly ScheduleLink[],
  calendar: WorkingCalendar,
): ScheduleResult {
  const byId = new Map(tasks.map((task) => [task.id, { ...task }]));
  const incoming = new Map<string, ScheduleLink[]>();
  const outgoing = new Map<string, ScheduleLink[]>();
  const indegree = new Map<string, number>();
  for (const task of tasks) indegree.set(task.id, 0);
  for (const link of links) {
    if (!byId.has(link.predecessorId) || !byId.has(link.successorId)) continue;
    incoming.set(link.successorId, [...(incoming.get(link.successorId) ?? []), link]);
    outgoing.set(link.predecessorId, [...(outgoing.get(link.predecessorId) ?? []), link]);
    indegree.set(link.successorId, (indegree.get(link.successorId) ?? 0) + 1);
  }

  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const link of outgoing.get(id) ?? []) {
      const next = (indegree.get(link.successorId) ?? 0) - 1;
      indegree.set(link.successorId, next);
      if (next === 0) queue.push(link.successorId);
    }
  }
  const cyclic = tasks.map((task) => task.id).filter((id) => !order.includes(id));

  const changes: ScheduleChange[] = [];
  for (const id of order) {
    const task = byId.get(id);
    const predecessors = incoming.get(id) ?? [];
    if (task?.start == null || task.end == null || predecessors.length === 0) continue;
    const duration = Math.max(1, businessDaysBetween(task.start, task.end, calendar));
    let earliestStart = alignToBusinessDay(task.start, calendar);
    for (const link of predecessors) {
      const predecessor = byId.get(link.predecessorId);
      if (predecessor?.start == null || predecessor.end == null) continue;
      let constraint: string;
      switch (link.type) {
        case 'FS':
          constraint = addBusinessDays(predecessor.end, 1 + link.lagDays, calendar);
          break;
        case 'SS':
          constraint = addBusinessDays(predecessor.start, link.lagDays, calendar);
          break;
        case 'FF':
          constraint = addBusinessDays(
            addBusinessDays(predecessor.end, link.lagDays, calendar),
            -(duration - 1),
            calendar,
          );
          break;
        case 'SF':
          constraint = addBusinessDays(
            addBusinessDays(predecessor.start, link.lagDays, calendar),
            -(duration - 1),
            calendar,
          );
          break;
      }
      if (constraint > earliestStart) earliestStart = constraint;
    }
    const newEnd = addBusinessDays(earliestStart, duration - 1, calendar);
    if (earliestStart > task.start) {
      changes.push({
        id,
        start: earliestStart,
        end: newEnd,
        previousStart: task.start,
        previousEnd: task.end,
      });
      task.start = earliestStart;
      task.end = newEnd;
    }
  }
  return { changes, cyclic };
}
