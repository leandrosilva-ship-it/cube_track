import type { BoardGroup, CriticalPathEntry, GanttDependency, GanttTask } from '@/lib/api/types';

/**
 * Ordenação/numeração EAP (WBS) e geometria das linhas de dependência do Gantt — funções puras
 * reaproveitadas tanto pela renderização quanto pelos testes. O número WBS (`task.wbs`, ex. "1.2.1")
 * já vem calculado pela API (`computeWbsNumbers`, ADR 0049); aqui só o interpretamos para ordenar e
 * indentar as linhas na mesma ordem (grupo → item de topo → subitens, por posição).
 */

function wbsSegments(wbs: string | null): number[] {
  return wbs === null ? [] : wbs.split('.').map(Number);
}

/** Compara dois códigos WBS numericamente segmento a segmento (não como texto: "1.2" < "1.10"). */
export function wbsCompare(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const as = wbsSegments(a);
  const bs = wbsSegments(b);
  const len = Math.max(as.length, bs.length);
  for (let index = 0; index < len; index += 1) {
    const diff = (as[index] ?? 0) - (bs[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Nível de indentação: "1.2" (item de topo) = 0, "1.2.1" (subitem) = 1, e assim por diante. */
export function wbsDepth(wbs: string | null): number {
  return Math.max(0, wbsSegments(wbs).length - 2);
}

export function sortTasksByWbs(tasks: readonly GanttTask[]): GanttTask[] {
  return [...tasks].sort((a, b) => wbsCompare(a.wbs, b.wbs));
}

export interface GanttRow {
  type: 'group' | 'task';
  key: string;
  depth: number;
  groupName?: string;
  groupColor?: string;
  task?: GanttTask;
}

/**
 * Linhas a renderizar, na ordem WBS (grupo → hierarquia). Com `showGroups`, insere uma linha de
 * cabeçalho a cada troca de grupo — como os itens já saem ordenados por grupo (1º segmento do WBS),
 * basta detectar a transição em vez de agrupar/particionar de novo.
 */
export function ganttRows(
  tasks: readonly GanttTask[],
  groups: readonly Pick<BoardGroup, 'id' | 'name' | 'color'>[],
  showGroups: boolean,
): GanttRow[] {
  const sorted = sortTasksByWbs(tasks);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const rows: GanttRow[] = [];
  let lastGroupId: string | null = null;
  for (const task of sorted) {
    if (showGroups && task.groupId !== lastGroupId) {
      const group = groupById.get(task.groupId);
      rows.push({
        type: 'group',
        key: `group:${task.groupId}`,
        depth: 0,
        groupName: group?.name ?? task.groupId,
        groupColor: group?.color ?? '#c4c4c4',
      });
      lastGroupId = task.groupId;
    }
    rows.push({ type: 'task', key: task.id, depth: wbsDepth(task.wbs), task });
  }
  return rows;
}

export interface DependencyConnector {
  id: string;
  path: string;
  critical: boolean;
}

/**
 * Geometria (path SVG, cotovelo horizontal→vertical→horizontal) de cada dependência visível — só
 * para pares de tarefas com datas e linha conhecidas (um predecessor/sucessor fora do board nunca
 * deveria ocorrer, mas datas ausentes são normais para itens sem agendamento).
 */
export function dependencyConnectors(
  dependencies: readonly GanttDependency[],
  tasksById: ReadonlyMap<string, GanttTask>,
  rowIndexById: ReadonlyMap<string, number>,
  criticalPath: readonly CriticalPathEntry[],
  rangeStart: string,
  pxPerDay: number,
  rowHeight: number,
  dateToX: (date: string, rangeStart: string, pxPerDay: number) => number,
): DependencyConnector[] {
  const criticalIds = new Set(
    criticalPath.filter((entry) => entry.isCritical).map((entry) => entry.id),
  );
  const connectors: DependencyConnector[] = [];
  for (const dependency of dependencies) {
    const predecessor = tasksById.get(dependency.predecessorId);
    const successor = tasksById.get(dependency.successorId);
    const predecessorRow = rowIndexById.get(dependency.predecessorId);
    const successorRow = rowIndexById.get(dependency.successorId);
    if (
      predecessor === undefined ||
      predecessor.start === null ||
      predecessor.end === null ||
      successor === undefined ||
      successor.start === null ||
      successor.end === null ||
      predecessorRow === undefined ||
      successorRow === undefined
    ) {
      continue;
    }
    const predecessorStartX = dateToX(predecessor.start, rangeStart, pxPerDay);
    const predecessorEndX = dateToX(predecessor.end, rangeStart, pxPerDay) + pxPerDay;
    const successorStartX = dateToX(successor.start, rangeStart, pxPerDay);
    const successorEndX = dateToX(successor.end, rangeStart, pxPerDay) + pxPerDay;
    const fromX = dependency.type === 'SS' || dependency.type === 'SF' ? predecessorStartX : predecessorEndX;
    const toX = dependency.type === 'FS' || dependency.type === 'SS' ? successorStartX : successorEndX;
    const fromY = predecessorRow * rowHeight + rowHeight / 2;
    const toY = successorRow * rowHeight + rowHeight / 2;
    const midX = (fromX + toX) / 2;
    connectors.push({
      id: dependency.id,
      path: `M ${String(fromX)} ${String(fromY)} H ${String(midX)} V ${String(toY)} H ${String(toX)}`,
      critical: criticalIds.has(dependency.predecessorId) && criticalIds.has(dependency.successorId),
    });
  }
  return connectors;
}
