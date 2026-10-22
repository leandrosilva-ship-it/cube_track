import { Injectable } from '@nestjs/common';
import { loadWorkingCalendar, schema } from '@cube-track/db';
import {
  computeCriticalPath,
  computeWbsNumbers,
  type CriticalPathEntry,
  type ScheduleLink,
  type ScheduleTask,
} from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { AccessService } from '../../access/application/access.service.js';
import { NATIVE_FIELD_BINDINGS, type NativeField } from '../../work/domain/item.js';

const { items, groups, dependencies } = schema;

export interface GanttTaskDto {
  id: string;
  parentItemId: string | null;
  groupId: string;
  name: string;
  wbs: string | null;
  position: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  /** Datas vigentes (replanejado se houver, senão planejado) — o que o worker também usa. */
  start: string | null;
  end: string | null;
  progress: string | null;
  isMilestone: boolean;
  scheduleMode: 'auto' | 'manual';
}

export interface GanttDependencyDto {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

export interface GanttData {
  tasks: GanttTaskDto[];
  dependencies: GanttDependencyDto[];
  criticalPath: CriticalPathEntry[];
  calendar: { workingDays: number[]; holidays: string[] };
}

/** Dados do Gantt/Cronograma: tarefas com WBS, dependências e caminho crítico (ADR 0049). */
@Injectable()
export class GanttService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
  ) {}

  async data(user: AuthPrincipal, boardId: string): Promise<GanttData> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const { hidden, columns } = await this.access.hiddenColumns(user, boardId);
    const hiddenBindings = new Set(
      columns.flatMap((column) =>
        hidden.has(column.key) && column.binding !== null ? [column.binding] : [],
      ),
    );
    const native = (field: NativeField, value: string | null): string | null =>
      hiddenBindings.has(NATIVE_FIELD_BINDINGS[field]) ? null : value;
    const [groupRows, itemRows, linkRows] = await Promise.all([
      tx
        .select({ id: groups.id, position: groups.position })
        .from(groups)
        .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
        .orderBy(asc(groups.position)),
      tx
        .select()
        .from(items)
        .where(
          and(eq(items.boardId, boardId), isNull(items.deletedAt), isNull(items.archivedAt)),
        )
        .orderBy(asc(items.position)),
      tx
        .select({
          id: dependencies.id,
          predecessorId: dependencies.predecessorId,
          successorId: dependencies.successorId,
          type: dependencies.type,
          lagDays: dependencies.lagDays,
        })
        .from(dependencies)
        .where(eq(dependencies.boardId, boardId)),
    ]);

    const wbs = computeWbsNumbers(
      groupRows,
      itemRows.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        parentItemId: item.parentItemId,
        position: item.position,
      })),
    );

    const scheduleTasks: ScheduleTask[] = itemRows.map((item) => ({
      id: item.id,
      start: item.replannedStartDate ?? item.plannedStartDate,
      end: item.replannedEndDate ?? item.plannedEndDate,
    }));

    const effectiveById = new Map(scheduleTasks.map((task) => [task.id, task]));
    const tasks: GanttTaskDto[] = itemRows.map((item) => {
      const effective = effectiveById.get(item.id);
      const startHidden =
        item.replannedStartDate === null
          ? hiddenBindings.has(NATIVE_FIELD_BINDINGS.plannedStartDate)
          : hiddenBindings.has(NATIVE_FIELD_BINDINGS.replannedStartDate);
      const endHidden =
        item.replannedEndDate === null
          ? hiddenBindings.has(NATIVE_FIELD_BINDINGS.plannedEndDate)
          : hiddenBindings.has(NATIVE_FIELD_BINDINGS.replannedEndDate);
      return {
        id: item.id,
        parentItemId: item.parentItemId,
        groupId: item.groupId,
        name: item.name,
        wbs: wbs.get(item.id) ?? null,
        position: item.position,
        plannedStartDate: native('plannedStartDate', item.plannedStartDate),
        plannedEndDate: native('plannedEndDate', item.plannedEndDate),
        replannedStartDate: native('replannedStartDate', item.replannedStartDate),
        replannedEndDate: native('replannedEndDate', item.replannedEndDate),
        actualStartDate: native('actualStartDate', item.actualStartDate),
        actualEndDate: native('actualEndDate', item.actualEndDate),
        start: startHidden ? null : (effective?.start ?? null),
        end: endHidden ? null : (effective?.end ?? null),
        progress: native('progress', item.progress),
        isMilestone: item.isMilestone,
        scheduleMode: item.scheduleMode,
      };
    });
    const links: ScheduleLink[] = linkRows.map((row) => ({
      predecessorId: row.predecessorId,
      successorId: row.successorId,
      type: row.type,
      lagDays: row.lagDays,
    }));

    const starts = scheduleTasks
      .map((task) => task.start)
      .filter((date): date is string => date !== null);
    let criticalPath: CriticalPathEntry[] = [];
    let calendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] as string[] };
    if (starts.length > 0 && links.length > 0) {
      const from = starts.reduce((min, date) => (date < min ? date : min));
      const working = await loadWorkingCalendar(tx, user.tenantId, boardId, from);
      calendar = { workingDays: [...working.workingDays], holidays: [...working.holidays] };
      criticalPath = computeCriticalPath(scheduleTasks, links, working).tasks;
    }

    return { tasks, dependencies: linkRows, criticalPath, calendar };
  }
}
