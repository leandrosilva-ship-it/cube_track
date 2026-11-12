import { schema, type DatabaseHandle } from '@cube-track/db';
import type { EmailJob } from '@cube-track/shared';
import type { Queue } from 'bullmq';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { runAsSystem } from '../system-tx.js';

const { memberships, roles, users } = schema;

export interface BillingReconciliationDeps {
  database: DatabaseHandle;
  redis: Redis;
  emails: Queue;
  appUrl: string;
  logger: Logger;
}

export interface BillingReconciliationOutcome {
  tenantId: string;
  subscriptionId: string;
  status: string;
}

/**
 * Rede de segurança diária de billing (ADR 0059, `app.billing_reconciliation_candidates()`): avisa
 * o(s) proprietário(s)/administrador(es) de cada tenant com assinatura `past_due` ou com o período
 * corrente vencido há mais de 2 dias sem confirmação do webhook do Stripe. NUNCA muda
 * `subscriptions.status`/`tenants.plan` sozinha — isso é sempre o webhook (ou, para Pix/boleto, o
 * adaptador stub) — esta rotina só notifica; ver a lacuna documentada em `docs/billing.md` §5 sobre
 * o caso (raro) de o webhook nunca chegar.
 */
export function createBillingReconciliationDaily(deps: BillingReconciliationDeps) {
  return async function runBillingReconciliation(): Promise<{
    outcomes: BillingReconciliationOutcome[];
  }> {
    const result = await deps.database.db.execute<{
      tenant_id: string;
      subscription_id: string;
      status: string;
      current_period_end: Date | null;
    }>(sql`select * from app.billing_reconciliation_candidates()`);
    const outcomes: BillingReconciliationOutcome[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const row of result.rows) {
      const emailJobs: EmailJob[] = [];
      await runAsSystem(
        deps.database,
        deps.redis,
        row.tenant_id,
        {
          kind: 'system',
          causationId: null,
          depth: 0,
          correlationId: `billing-reconciliation-daily:${row.subscription_id}`,
        },
        async (unit) => {
          const { tx } = unit;
          const recipients = await tx
            .select({ email: users.email, name: users.name })
            .from(memberships)
            .innerJoin(roles, eq(roles.id, memberships.roleId))
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(
              and(
                eq(memberships.tenantId, row.tenant_id),
                isNull(memberships.deletedAt),
                eq(memberships.status, 'active'),
                inArray(roles.key, ['owner', 'admin']),
              ),
            );
          const link = `${deps.appUrl}/settings/billing`;
          const message =
            row.status === 'past_due'
              ? 'O pagamento da assinatura falhou e está pendente de regularização.'
              : 'O período da assinatura venceu sem confirmação de renovação.';
          for (const recipient of recipients) {
            emailJobs.push({
              to: recipient.email,
              template: 'billing_payment_issue',
              locale: 'pt-BR',
              data: { name: recipient.name, message, link },
            });
          }
          await unit.audit({
            action: 'billing.reconciliation_alerted',
            entityType: 'subscription',
            entityId: row.subscription_id,
            after: { status: row.status, recipients: recipients.length },
          });
        },
      );
      for (const email of emailJobs) {
        await deps.emails.add(email.template, email, {
          jobId: `billing-reconciliation-daily:${row.subscription_id}:${email.to}:${today}`,
        });
      }
      outcomes.push({ tenantId: row.tenant_id, subscriptionId: row.subscription_id, status: row.status });
    }
    deps.logger.info({ checked: outcomes.length }, 'Candidatos de reconciliação de billing avaliados');
    return { outcomes };
  };
}
