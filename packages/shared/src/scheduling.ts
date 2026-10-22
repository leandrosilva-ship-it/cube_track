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
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
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
    if (task === undefined || task.start === null || task.end === null || predecessors.length === 0)
      continue;
    const duration = Math.max(1, businessDaysBetween(task.start, task.end, calendar));
    let earliestStart = alignToBusinessDay(task.start, calendar);
    for (const link of predecessors) {
      const predecessor = byId.get(link.predecessorId);
      if (predecessor === undefined || predecessor.start === null || predecessor.end === null)
        continue;
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

/**
 * Caminho crítico (CPM) sobre o cronograma **atual** (datas já definidas de cada tarefa, não
 * recalculadas): passagem para trás a partir do término do projeto (maior término entre as
 * tarefas) para achar término/início tardios e a folga total de cada tarefa. Folga zero (ou
 * negativa, atraso) marca a tarefa como crítica. Tarefas em ciclo ou sem datas ficam de fora.
 */
export interface CriticalPathEntry {
  id: string;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  /** Dias úteis de folga (negativo = já atrasada em relação ao término do projeto). */
  totalFloatDays: number;
  isCritical: boolean;
}

export interface CriticalPathResult {
  tasks: CriticalPathEntry[];
  cyclic: string[];
}

function signedBusinessDaysBetween(from: string, to: string, calendar: WorkingCalendar): number {
  return from <= to
    ? businessDaysBetween(from, to, calendar) - 1
    : -(businessDaysBetween(to, from, calendar) - 1);
}

interface DatedTask {
  id: string;
  start: string;
  end: string;
}

/** Limite imposto a um predecessor pela data tardia já resolvida do seu sucessor. */
function lateBoundFromSuccessor(
  link: ScheduleLink,
  predecessorDuration: number,
  successorLateStart: string,
  successorLateFinish: string,
  calendar: WorkingCalendar,
): string {
  switch (link.type) {
    case 'FS':
      return addBusinessDays(successorLateStart, -1 - link.lagDays, calendar);
    case 'SS':
      return addBusinessDays(
        addBusinessDays(successorLateStart, -link.lagDays, calendar),
        predecessorDuration - 1,
        calendar,
      );
    case 'FF':
      return addBusinessDays(successorLateFinish, -link.lagDays, calendar);
    case 'SF':
      return addBusinessDays(
        addBusinessDays(successorLateFinish, -link.lagDays, calendar),
        predecessorDuration - 1,
        calendar,
      );
  }
}

export function computeCriticalPath(
  tasks: readonly ScheduleTask[],
  links: readonly ScheduleLink[],
  calendar: WorkingCalendar,
): CriticalPathResult {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const outgoing = new Map<string, ScheduleLink[]>();
  const indegree = new Map<string, number>();
  for (const task of tasks) indegree.set(task.id, 0);
  for (const link of links) {
    if (!byId.has(link.predecessorId) || !byId.has(link.successorId)) continue;
    outgoing.set(link.predecessorId, [...(outgoing.get(link.predecessorId) ?? []), link]);
    indegree.set(link.successorId, (indegree.get(link.successorId) ?? 0) + 1);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id);
  const order: string[] = [];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    order.push(id);
    for (const link of outgoing.get(id) ?? []) {
      const next = (indegree.get(link.successorId) ?? 0) - 1;
      indegree.set(link.successorId, next);
      if (next === 0) queue.push(link.successorId);
    }
  }
  const cyclic = tasks.map((task) => task.id).filter((id) => !order.includes(id));

  const scheduled: DatedTask[] = [];
  for (const id of order) {
    const task = byId.get(id);
    if (task === undefined || task.start === null || task.end === null) continue;
    scheduled.push({ id: task.id, start: task.start, end: task.end });
  }
  if (scheduled.length === 0) return { tasks: [], cyclic };

  let projectFinish = '';
  for (const task of scheduled) if (task.end > projectFinish) projectFinish = task.end;

  const lateFinish = new Map<string, string>();
  const lateStart = new Map<string, string>();
  const results: CriticalPathEntry[] = [];
  for (let index = scheduled.length - 1; index >= 0; index -= 1) {
    const task = scheduled[index];
    if (task === undefined) continue;
    const duration = Math.max(1, businessDaysBetween(task.start, task.end, calendar));
    let lateFinishOf = projectFinish;
    for (const link of outgoing.get(task.id) ?? []) {
      const succStart = lateStart.get(link.successorId);
      const succFinish = lateFinish.get(link.successorId);
      if (succStart === undefined || succFinish === undefined) continue;
      const bound = lateBoundFromSuccessor(link, duration, succStart, succFinish, calendar);
      if (bound < lateFinishOf) lateFinishOf = bound;
    }
    const lateStartOf = addBusinessDays(lateFinishOf, -(duration - 1), calendar);
    lateFinish.set(task.id, lateFinishOf);
    lateStart.set(task.id, lateStartOf);
    const totalFloatDays = signedBusinessDaysBetween(task.start, lateStartOf, calendar);
    results.push({
      id: task.id,
      earlyStart: task.start,
      earlyFinish: task.end,
      lateStart: lateStartOf,
      lateFinish: lateFinishOf,
      totalFloatDays,
      isCritical: totalFloatDays <= 0,
    });
  }
  return { tasks: results, cyclic };
}
