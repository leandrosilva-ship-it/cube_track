import { schema, type DatabaseHandle } from '@cube-track/db';
import {
  computeContractBalance,
  evaluateExpiring,
  evaluateLowBalance,
  evaluateStalledOrder,
  type ContractAlert,
  type EmailJob,
} from '@cube-track/shared';
import type { Queue } from 'bullmq';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { notifyUser } from './notifications.js';
import { runAsSystem, type SystemUnit } from '../system-tx.js';

const { contracts, serviceOrders } = schema;

export interface ContractAlertsDeps {
  database: DatabaseHandle;
  redis: Redis;
  emails: Queue;
  appUrl: string;
  logger: Logger;
}

export interface ContractAlertOutcome {
  contractId: string;
  alerts: number;
}

const EMAIL_TEMPLATE_OF: Record<ContractAlert['type'], 'contract_balance_low' | 'contract_expiring' | 'service_order_stalled'> = {
  low_balance: 'contract_balance_low',
  expiring: 'contract_expiring',
  service_order_stalled: 'service_order_stalled',
};

async function notifyManager(
  unit: SystemUnit,
  tenantId: string,
  contractId: string,
  managerId: string,
  alert: ContractAlert,
  link: string,
): Promise<EmailJob | null> {
  const email = await notifyUser(unit.tx, tenantId, null, {
    userId: managerId,
    type: 'contract_alert',
    title: alert.message,
    entityType: 'contract',
    entityId: contractId,
  });
  await unit.emit({
    type: 'notification.created',
    aggregateType: 'notification',
    aggregateId: contractId,
    userId: managerId,
    payload: { notificationId: contractId, type: 'contract_alert', title: alert.message, itemId: null, boardId: null },
  });
  if (email === null) return null;
  return {
    to: email,
    template: EMAIL_TEMPLATE_OF[alert.type],
    locale: 'pt-BR',
    data: { message: alert.message, link },
  };
}

/**
 * Alertas diários de contrato (ADR 0054): `app.contract_alert_candidates()` devolve os contratos
 * ativos; saldo baixo, vigência perto do fim e OS paradas são avaliados aqui em TypeScript com o
 * mesmo motor testado do pacote compartilhado (`contracts.ts`) — a função SQL só filtra candidatos.
 * Notifica o gestor do contrato (`contracts.managerId`), quando existir.
 */
export function createContractAlertsDaily(deps: ContractAlertsDeps) {
  return async function runContractAlerts(): Promise<{ outcomes: ContractAlertOutcome[] }> {
    const result = await deps.database.db.execute<{ tenant_id: string; contract_id: string }>(
      sql`select * from app.contract_alert_candidates()`,
    );
    const outcomes: ContractAlertOutcome[] = [];
    for (const row of result.rows) {
      const emailJobs: EmailJob[] = [];
      const alertCount = await runAsSystem(
        deps.database,
        deps.redis,
        row.tenant_id,
        { kind: 'system', causationId: null, depth: 0, correlationId: `contract-alerts-daily:${row.contract_id}` },
        async (unit) => {
          const { tx } = unit;
          const [contract] = await tx
            .select()
            .from(contracts)
            .where(and(eq(contracts.id, row.contract_id), isNull(contracts.deletedAt)));
          if (contract === undefined || contract.managerId === null) return 0;
          const orders = await tx
            .select({ id: serviceOrders.id, status: serviceOrders.status, totalUst: serviceOrders.totalUst, requestedAt: serviceOrders.requestedAt })
            .from(serviceOrders)
            .where(and(eq(serviceOrders.contractId, contract.id), isNull(serviceOrders.deletedAt)));
          const balance = computeContractBalance(
            Number(contract.ustContracted),
            orders.map((order) => ({ status: order.status, totalUst: Number(order.totalUst) })),
          );
          const today = new Date().toISOString().slice(0, 10);
          const alerts: ContractAlert[] = [];
          const lowBalance = evaluateLowBalance(balance);
          if (lowBalance !== null) alerts.push(lowBalance);
          const expiring = evaluateExpiring(contract.endDate, today);
          if (expiring !== null) alerts.push(expiring);
          for (const order of orders) {
            if (order.status !== 'requested' || order.requestedAt === null) continue;
            const stalled = evaluateStalledOrder(order.requestedAt, today);
            if (stalled !== null) alerts.push(stalled);
          }
          const link = `${deps.appUrl}/contracts/${contract.id}`;
          for (const alert of alerts) {
            const email = await notifyManager(unit, row.tenant_id, contract.id, contract.managerId, alert, link);
            if (email !== null) emailJobs.push(email);
          }
          return alerts.length;
        },
      );
      const today = new Date().toISOString().slice(0, 10);
      for (const email of emailJobs)
        await deps.emails.add(email.template, email, {
          jobId: `contract-alerts-daily:${row.contract_id}:${email.template}:${email.to}:${today}`,
        });
      outcomes.push({ contractId: row.contract_id, alerts: alertCount });
    }
    deps.logger.info({ contracts: outcomes.length, alerts: outcomes.reduce((sum, o) => sum + o.alerts, 0) }, 'Alertas diários de contrato concluídos');
    return { outcomes };
  };
}
