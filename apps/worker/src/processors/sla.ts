import { schema, type DatabaseHandle } from '@cube-track/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { runAsSystem } from '../system-tx.js';

const { slaTrackers, slas, slaEvents, items, columnDefinitions, teamMembers, notifications } = schema;

export interface SlaCheckOutcome {
  trackerId: string;
  kind: 'warning' | 'breached';
  status: 'applied' | 'skipped';
}

function personIdsOf(
  values: Record<string, Record<string, unknown>>,
  keys: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    const list = values[key]?.personIds;
    if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
  }
  return [...ids];
}

/**
 * Verificação periódica de SLA (rotina de manutenção `sla-check`, ADR 0051): `app.sla_tracker_alerts()`
 * devolve os trackers que entraram em aviso (`warningAt` atingido, ainda sem evento) ou violação
 * (`dueAt` vencido). Para cada um, grava `sla_events`, emite `sla.changed` e notifica os responsáveis
 * do item (colunas de pessoas do board). Um tracker violado muda para `status: 'breached'`; um em
 * aviso permanece `running` (o aviso é só um evento + um status transitório no payload realtime).
 */
export function createSlaCheck(deps: { database: DatabaseHandle; redis: Redis; logger: Logger }) {
  return async function runSlaCheck(): Promise<{ outcomes: SlaCheckOutcome[] }> {
    const result = await deps.database.db.execute<{
      tenant_id: string;
      tracker_id: string;
      sla_id: string;
      item_id: string;
      board_id: string;
      kind: 'warning' | 'breached';
    }>(sql`select * from app.sla_tracker_alerts()`);
    const outcomes: SlaCheckOutcome[] = [];
    for (const row of result.rows) {
      const status = await runAsSystem(
        deps.database,
        deps.redis,
        row.tenant_id,
        { kind: 'system', causationId: null, depth: 0, correlationId: `sla-check:${row.tracker_id}` },
        async (unit) => {
          const { tx } = unit;
          const [tracker] = await tx
            .select()
            .from(slaTrackers)
            .where(and(eq(slaTrackers.id, row.tracker_id), eq(slaTrackers.status, 'running')))
            .for('update');
          if (tracker === undefined) return 'skipped' as const;

          const [sla] = await tx.select().from(slas).where(eq(slas.id, row.sla_id));
          const [item] = await tx.select().from(items).where(eq(items.id, row.item_id));
          if (sla === undefined || item === undefined) return 'skipped' as const;

          const now = new Date();
          const elapsedMinutes = Math.round((now.getTime() - tracker.startedAt.getTime()) / 60_000);

          if (row.kind === 'breached') {
            await tx
              .update(slaTrackers)
              .set({ status: 'breached', completedAt: now })
              .where(eq(slaTrackers.id, tracker.id));
          } else {
            const [existing] = await tx
              .select({ id: slaEvents.id })
              .from(slaEvents)
              .where(and(eq(slaEvents.trackerId, tracker.id), eq(slaEvents.type, 'warning')));
            if (existing !== undefined) return 'skipped' as const;
          }

          await tx.insert(slaEvents).values({
            tenantId: row.tenant_id,
            slaId: sla.id,
            trackerId: tracker.id,
            itemId: item.id,
            type: row.kind,
            elapsedMinutes,
          });

          await unit.emit({
            type: 'sla.changed',
            aggregateType: 'sla_tracker',
            aggregateId: tracker.id,
            boardId: row.board_id,
            itemId: item.id,
            payload: {
              trackerId: tracker.id,
              itemId: item.id,
              boardId: row.board_id,
              status: row.kind,
            },
          });

          const peopleColumns = await tx
            .select({ key: columnDefinitions.key })
            .from(columnDefinitions)
            .where(
              and(
                eq(columnDefinitions.boardId, row.board_id),
                eq(columnDefinitions.type, 'people'),
                isNull(columnDefinitions.deletedAt),
              ),
            );
          const peopleKeys = peopleColumns.map((column) => column.key);
          const recipients = new Set(personIdsOf(item.values, peopleKeys));
          const teamIds = peopleKeys
            .flatMap((key) => {
              const teams = item.values[key]?.teamIds;
              return Array.isArray(teams) ? teams.map(String) : [];
            })
            .filter((value, index, all) => all.indexOf(value) === index);
          if (teamIds.length > 0) {
            const members = await tx
              .select({ userId: teamMembers.userId })
              .from(teamMembers)
              .where(inArray(teamMembers.teamId, teamIds));
            members.forEach((member) => recipients.add(member.userId));
          }
          const title =
            row.kind === 'breached'
              ? `SLA "${sla.name}" violado em "${item.name}".`
              : `SLA "${sla.name}" perto do prazo em "${item.name}".`;
          for (const userId of recipients) {
            const [created] = await tx
              .insert(notifications)
              .values({
                tenantId: row.tenant_id,
                userId,
                type: 'sla',
                title,
                boardId: row.board_id,
                itemId: item.id,
                entityType: 'sla_tracker',
                entityId: tracker.id,
              })
              .returning({ id: notifications.id });
            if (created === undefined) continue;
            await unit.emit({
              type: 'notification.created',
              aggregateType: 'notification',
              aggregateId: created.id,
              userId,
              payload: {
                notificationId: created.id,
                type: 'sla',
                title,
                itemId: item.id,
                boardId: row.board_id,
              },
            });
          }
          return 'applied' as const;
        },
      );
      outcomes.push({ trackerId: row.tracker_id, kind: row.kind, status });
    }
    return { outcomes };
  };
}
