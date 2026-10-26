import { appendAuditLog, withTenant, type DatabaseHandle } from '@cube-track/db';
import { TRASH_RETENTION_DAYS, type MaintenanceJob } from '@cube-track/shared';
import type { Job, Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import type { Logger } from '../logger.js';
import { scheduleVolatile } from './computed.js';

/** Horários (fuso de Brasília) das rotinas diárias. */
export const MAINTENANCE_SCHEDULE: Record<MaintenanceJob, string> = {
  'purge-trash': '15 3 * * *',
  'recompute-volatile': '5 0 * * *',
  'automations-date-check': '10 6 * * *',
  'sla-check': '*/10 * * * *',
  'notification-digest-hourly': '0 * * * *',
  'notification-digest-daily': '0 8 * * *',
};
const TIMEZONE = 'America/Sao_Paulo';

/** Registra as rotinas diárias como jobs repetíveis (idempotente entre reinícios). */
export async function scheduleMaintenance(queue: Queue): Promise<void> {
  for (const [name, pattern] of Object.entries(MAINTENANCE_SCHEDULE)) {
    await queue.upsertJobScheduler(name, { pattern, tz: TIMEZONE }, { name, data: {} });
  }
}

interface MaintenanceDeps {
  database: DatabaseHandle;
  computedQueue: Queue;
  logger: Logger;
  checkDateArrives: () => Promise<{ outcomes: { automationId: string; status: string }[] }>;
  checkSla: () => Promise<{ outcomes: { trackerId: string; kind: string; status: string }[] }>;
  checkNotificationDigest: (
    cadence: 'hourly' | 'daily',
  ) => Promise<{ outcomes: { tenantId: string; userId: string; count: number }[] }>;
}

/** Expurgo da lixeira (30 dias) com auditoria por tenant. */
export async function purgeTrash(
  database: DatabaseHandle,
  now: Date = new Date(),
): Promise<Map<string, { items: number; groups: number }>> {
  const before = new Date(now.getTime() - TRASH_RETENTION_DAYS * 86_400_000);
  const result = await database.db.execute<{
    tenant_id: string;
    items_purged: number;
    groups_purged: number;
  }>(sql`select * from app.purge_trash(${before.toISOString()}::timestamptz)`);
  const totals = new Map<string, { items: number; groups: number }>();
  for (const row of result.rows) {
    const total = totals.get(row.tenant_id) ?? { items: 0, groups: 0 };
    total.items += row.items_purged;
    total.groups += row.groups_purged;
    totals.set(row.tenant_id, total);
  }
  for (const [tenantId, total] of totals) {
    await withTenant(database.db, { tenantId, userId: null }, (tx) =>
      appendAuditLog(tx, {
        tenantId,
        actorId: null,
        actorKind: 'system',
        action: 'trash.purged',
        entityType: 'tenant',
        entityId: tenantId,
        after: { ...total, before: before.toISOString() },
      }),
    );
  }
  return totals;
}

export function maintenanceProcessor(deps: MaintenanceDeps) {
  return async (job: Job<unknown>) => {
    switch (job.name as MaintenanceJob) {
      case 'purge-trash': {
        const totals = await purgeTrash(deps.database);
        deps.logger.info({ tenants: totals.size }, 'Lixeira expurgada');
        return;
      }
      case 'recompute-volatile': {
        const boards = await scheduleVolatile(deps.database, deps.computedQueue);
        deps.logger.info({ boards }, 'Recálculo de fórmulas voláteis agendado');
        return;
      }
      case 'automations-date-check': {
        const { outcomes } = await deps.checkDateArrives();
        deps.logger.info(
          {
            checked: outcomes.length,
            succeeded: outcomes.filter((o) => o.status === 'succeeded').length,
          },
          'Varredura diária de automações por data (date_arrives) concluída',
        );
        return;
      }
      case 'sla-check': {
        const { outcomes } = await deps.checkSla();
        deps.logger.info(
          {
            checked: outcomes.length,
            applied: outcomes.filter((o) => o.status === 'applied').length,
          },
          'Verificação periódica de SLA concluída',
        );
        return;
      }
      case 'notification-digest-hourly': {
        const { outcomes } = await deps.checkNotificationDigest('hourly');
        deps.logger.info({ sent: outcomes.length }, 'Digest horário de notificações concluído');
        return;
      }
      case 'notification-digest-daily': {
        const { outcomes } = await deps.checkNotificationDigest('daily');
        deps.logger.info({ sent: outcomes.length }, 'Digest diário de notificações concluído');
        return;
      }
      default:
        throw new Error(`Rotina desconhecida: ${job.name}`);
    }
  };
}
