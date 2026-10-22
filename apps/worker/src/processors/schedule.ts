import { loadWorkingCalendar, schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import {
  DomainEventJobSchema,
  ScheduleJobSchema,
  computeSchedule,
  type ItemFieldChange,
  type ScheduleJob,
  type ScheduleLink,
  type ScheduleTask,
} from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { runAsSystem } from '../system-tx.js';

const { items, dependencies, columnDefinitions } = schema;

/** Campos cuja mudança dispara o recálculo. */
export const SCHEDULE_FIELDS: ReadonlySet<string> = new Set([
  'plannedStartDate',
  'plannedEndDate',
  'replannedStartDate',
  'replannedEndDate',
  // Adicionar/remover/editar um predecessor também precisa recalcular o próprio item (ele pode
  // ficar fora do prazo em relação ao novo vínculo) e, a partir dele, as sucessoras.
  'dependencies',
]);

const DATE_BINDINGS = {
  plannedStartDate: 'item.planned_start_date',
  plannedEndDate: 'item.planned_end_date',
  replannedStartDate: 'item.replanned_start_date',
  replannedEndDate: 'item.replanned_end_date',
} as const;

/** Erro transitório (escrita concorrente): o job é reprocessado pela política de retentativas. */
export class ScheduleConflictError extends Error {
  override readonly name = 'ScheduleConflictError';
}

/** Converte o job recebido (evento de domínio do relay ou pedido explícito) em pedido de recálculo. */
export function toScheduleJob(raw: unknown): ScheduleJob | null {
  const event = DomainEventJobSchema.safeParse(raw);
  if (!event.success) return ScheduleJobSchema.parse(raw);
  const { type, tenantId, boardId, itemId, payload, eventId, depth } = event.data;
  if (type !== 'item.updated' || boardId === null || itemId === null) return null;
  const changes = Array.isArray(payload.changes) ? (payload.changes as { field?: unknown }[]) : [];
  if (
    !changes.some((change) => typeof change.field === 'string' && SCHEDULE_FIELDS.has(change.field))
  )
    return null;
  return { tenantId, boardId, itemId, causationId: eventId, depth };
}

/** Sucessores (diretos e indiretos) de `itemId`, incluindo o próprio item. */
function downstream(itemId: string, links: readonly ScheduleLink[]): Set<string> {
  const reached = new Set([itemId]);
  const queue = [itemId];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    for (const link of links) {
      if (link.predecessorId === current && !reached.has(link.successorId)) {
        reached.add(link.successorId);
        queue.push(link.successorId);
      }
    }
  }
  return reached;
}

/**
 * Recálculo de cronograma por dependências (FS/SS/FF/SF + lag em dias úteis, feriados do
 * calendário). Usa o plano vigente de cada item (replanejado, se houver, senão planejado) e grava no
 * mesmo par de campos. Cada sucessor movido recebe versão nova, auditoria `item.rescheduled`,
 * atividade e evento `item.updated` (realtime) na mesma transação.
 */
export function scheduleProcessor(deps: { database: DatabaseHandle; redis: Redis }) {
  return async (job: Job): Promise<{ rescheduled: number; cyclic: number }> => {
    const request = toScheduleJob(job.data);
    if (request === null) return { rescheduled: 0, cyclic: 0 };
    const correlationId = request.causationId ?? job.id ?? request.boardId;

    const result = await withTenant(
      deps.database.db,
      { tenantId: request.tenantId, userId: null },
      async (tx) => {
        const rows = await tx
          .select({
            id: items.id,
            version: items.version,
            plannedStartDate: items.plannedStartDate,
            plannedEndDate: items.plannedEndDate,
            replannedStartDate: items.replannedStartDate,
            replannedEndDate: items.replannedEndDate,
            scheduleMode: items.scheduleMode,
          })
          .from(items)
          .where(and(eq(items.boardId, request.boardId), isNull(items.deletedAt)));
        const manualIds = new Set(
          rows.filter((row) => row.scheduleMode === 'manual').map((row) => row.id),
        );
        // Um item em modo manual nunca é empurrado: o vínculo em que ele é sucessor é ignorado (ele
        // continua constrangendo as próprias sucessoras normalmente, com as datas que já tem).
        const links: ScheduleLink[] = (
          await tx
            .select({
              predecessorId: dependencies.predecessorId,
              successorId: dependencies.successorId,
              type: dependencies.type,
              lagDays: dependencies.lagDays,
            })
            .from(dependencies)
            .where(eq(dependencies.boardId, request.boardId))
        )
          .map((link) => ({ ...link }))
          .filter((link) => !manualIds.has(link.successorId));
        if (links.length === 0) return null;
        const tasks: ScheduleTask[] = rows.map((row) => ({
          id: row.id,
          start: row.replannedStartDate ?? row.plannedStartDate,
          end: row.replannedEndDate ?? row.plannedEndDate,
        }));
        const starts = tasks
          .map((task) => task.start)
          .filter((date): date is string => date !== null);
        if (starts.length === 0) return null;
        const calendar = await loadWorkingCalendar(
          tx,
          request.tenantId,
          request.boardId,
          starts.reduce((min, date) => (date < min ? date : min)),
        );
        const schedule = computeSchedule(tasks, links, calendar);
        const scope = request.itemId === null ? null : downstream(request.itemId, links);
        return {
          rows: new Map(rows.map((row) => [row.id, row])),
          changes: schedule.changes.filter((change) => scope === null || scope.has(change.id)),
          cyclic: schedule.cyclic.length,
        };
      },
    );
    if (result === null || result.changes.length === 0)
      return { rescheduled: 0, cyclic: result?.cyclic ?? 0 };

    await runAsSystem(
      deps.database,
      deps.redis,
      request.tenantId,
      { kind: 'system', causationId: request.causationId, depth: request.depth + 1, correlationId },
      async (unit) => {
        const ids = result.changes.map((change) => change.id);
        const current = await unit.tx
          .select()
          .from(items)
          .where(and(inArray(items.id, ids), isNull(items.deletedAt)))
          .for('update');
        const peopleKeys = (
          await unit.tx
            .select({ key: columnDefinitions.key })
            .from(columnDefinitions)
            .where(
              and(
                eq(columnDefinitions.boardId, request.boardId),
                eq(columnDefinitions.type, 'people'),
                isNull(columnDefinitions.deletedAt),
              ),
            )
        ).map((column) => column.key);
        for (const change of result.changes) {
          const item = current.find((row) => row.id === change.id);
          const loaded = result.rows.get(change.id);
          if (item === undefined || loaded === undefined) continue;
          if (item.version !== loaded.version)
            throw new ScheduleConflictError(`Item ${item.id} alterado durante o recálculo.`);
          const replanned = item.replannedStartDate !== null || item.replannedEndDate !== null;
          const startField = replanned ? 'replannedStartDate' : 'plannedStartDate';
          const endField = replanned ? 'replannedEndDate' : 'plannedEndDate';
          const fieldVersions = { ...item.fieldVersions };
          const changes: ItemFieldChange[] = [];
          const before: Record<string, unknown> = {};
          const after: Record<string, unknown> = {};
          for (const [field, value] of [
            [startField, change.start],
            [endField, change.end],
          ] as const) {
            if (item[field] === value) continue;
            fieldVersions[field] = (fieldVersions[field] ?? 0) + 1;
            changes.push({ field, kind: 'native', value, version: fieldVersions[field] });
            before[field] = item[field];
            after[field] = value;
            await unit.activity({
              boardId: item.boardId,
              itemId: item.id,
              action: 'item.rescheduled',
              columnKey: field,
              oldValue: item[field],
              newValue: value,
            });
          }
          if (changes.length === 0) continue;
          const [updated] = await unit.tx
            .update(items)
            .set({
              [startField]: change.start,
              [endField]: change.end,
              fieldVersions,
              version: item.version + 1,
              updatedBy: null,
              updatedAt: sql`now()`,
            })
            .where(eq(items.id, item.id))
            .returning({ version: items.version });
          await unit.audit({
            action: 'item.rescheduled',
            entityType: 'item',
            entityId: item.id,
            before,
            after,
            metadata: { triggerItemId: request.itemId },
          });
          await unit.emit({
            type: 'item.updated',
            aggregateType: 'item',
            aggregateId: item.id,
            boardId: item.boardId,
            itemId: item.id,
            payload: { itemId: item.id, version: updated?.version ?? item.version + 1, changes },
            routing: {
              assigneeIds: peopleKeys.flatMap((key) => {
                const list = item.values[key]?.personIds;
                return Array.isArray(list) ? list.map(String) : [];
              }),
              boundFields: changes.map(
                (entry) => DATE_BINDINGS[entry.field as keyof typeof DATE_BINDINGS],
              ),
            },
          });
        }
      },
    );
    return { rescheduled: result.changes.length, cyclic: result.cyclic };
  };
}
