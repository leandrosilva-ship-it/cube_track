import { sql } from 'drizzle-orm';
import { boolean, index, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { paymentMethodKind, paymentRecordStatus, planTier, subscriptionStatus } from './_enums.js';
import { MONEY, tenantFk, tenantTable } from './_helpers.js';

/**
 * Billing (Prompt 16, ADR 0059): assinatura (uma por tenant — `pro`/`business` passam pelo Stripe
 * de verdade; `free` não tem cobrança nenhuma) e o histórico de cobranças (`payment_records`, nome
 * deliberadamente diferente de `invoices`: já existe uma tabela `invoices` em `contracts.ts` para a
 * fatura de UST do Prompt 13, entidade de negócio totalmente diferente). O segredo do Stripe é da
 * PLATAFORMA (`APP_CONFIG.STRIPE_SECRET_KEY`), nunca por tenant — ao contrário de toda outra
 * integração deste projeto (BYOK), por isso não há coluna cifrada aqui.
 */

/** Uma linha por tenant: estado corrente do plano/assinatura. `stripeCustomerId`/
 * `stripeSubscriptionId` ficam `null` até o primeiro checkout pago (plano `free`, ou `pix`/`boleto`
 * do adaptador stub, que não cria cliente Stripe). */
export const subscriptions = tenantTable(
  'subscriptions',
  {
    plan: planTier('plan').notNull().default('free'),
    status: subscriptionStatus('status').notNull().default('none'),
    paymentMethod: paymentMethodKind('payment_method').notNull().default('none'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('subscriptions_tenant_key').on(t.tenantId),
    uniqueIndex('subscriptions_stripe_customer_key')
      .on(t.stripeCustomerId)
      .where(sql`${t.stripeCustomerId} is not null`),
    uniqueIndex('subscriptions_stripe_subscription_key')
      .on(t.stripeSubscriptionId)
      .where(sql`${t.stripeSubscriptionId} is not null`),
  ],
);

/** Histórico de cobranças de uma assinatura. `providerReferenceId` é o id da fatura/cobrança no
 * provedor (Stripe invoice id, ou o id determinístico do adaptador Pix/boleto) — único por tenant,
 * o que torna o webhook idempotente por construção (`insert ... on conflict do update`, nunca uma
 * tabela de dedupe de eventos à parte). `amount`: `numeric`/decimal string, nunca `float`
 * (CLAUDE.md §5) — mesma convenção de UST/dinheiro de `contracts.ts`. */
export const paymentRecords = tenantTable(
  'payment_records',
  {
    subscriptionId: uuid('subscription_id').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    currency: text('currency').notNull().default('BRL'),
    status: paymentRecordStatus('status').notNull().default('pending'),
    method: paymentMethodKind('method').notNull(),
    providerReferenceId: text('provider_reference_id'),
    description: text('description').notNull().default(''),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [
    tenantFk('payment_records', t.tenantId, t.subscriptionId, subscriptions, 'cascade'),
    index('payment_records_tenant_subscription_idx').on(t.tenantId, t.subscriptionId, t.issuedAt),
    uniqueIndex('payment_records_tenant_provider_ref_key')
      .on(t.tenantId, t.providerReferenceId)
      .where(sql`${t.providerReferenceId} is not null`),
  ],
);
