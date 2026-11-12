import { Inject, Injectable, Logger } from '@nestjs/common';
import { isPlanTier, type PlanTier, type SubscriptionStatus } from '@cube-track/shared';
import { verifyStripeSignature } from '@cube-track/shared/billing-webhook';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { UnauthorizedError, ValidationError } from '../../../core/errors/problems.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { BillingRepository } from '../infrastructure/billing.repository.js';

/** Subconjunto validado do evento do Stripe (ADR 0059) — nunca o SDK inteiro: só os campos lidos
 * aqui, com Zod na borda (CLAUDE.md §5), evitando `any`. */
const StripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});

const MetadataSchema = z.object({ tenantId: z.uuid().optional(), plan: z.string().optional() });

const CheckoutSessionObjectSchema = z.object({
  id: z.string(),
  customer: z.string().nullable().optional(),
  subscription: z.string().nullable().optional(),
  metadata: MetadataSchema.nullable().optional(),
});

const SubscriptionObjectSchema = z.object({
  id: z.string(),
  customer: z.string(),
  status: z.string(),
  cancel_at_period_end: z.boolean().optional(),
  current_period_start: z.number().optional(),
  current_period_end: z.number().optional(),
  metadata: MetadataSchema.nullable().optional(),
});

const InvoiceObjectSchema = z.object({
  id: z.string(),
  customer: z.string().nullable().optional(),
  subscription: z.string().nullable().optional(),
  amount_paid: z.number().optional(),
  amount_due: z.number().optional(),
  currency: z.string().optional(),
});

/** Mapa de status do Stripe → `SubscriptionStatus` do CUBE TRACK (mais restrito — ver
 * `packages/shared/src/billing.ts`). `incomplete_expired`/`unpaid`/`paused` não têm equivalente
 * dedicado: tratados como `incomplete` (mesma consequência prática: sem acesso pago confirmado). */
const STRIPE_STATUS_MAP: Record<string, SubscriptionStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'incomplete',
  unpaid: 'incomplete',
  paused: 'incomplete',
};

export interface WebhookResult {
  received: true;
  handled: boolean;
  eventType: string;
}

/**
 * Processa o webhook público do Stripe (ADR 0059). Resolve o tenant PRIMEIRO pelos metadados do
 * próprio evento (`metadata.tenantId`, ecoados de volta desde a criação do Checkout Session —
 * round-trip, ver `ports.ts`/`StripeAdapter`) e, só quando ausentes, cai para
 * `app.resolve_subscription_by_stripe_id` (pelo id de cliente/assinatura já gravado em
 * `subscriptions` por um evento anterior). Sem contexto de tenant até aqui — mesmo motivo de
 * `MailInboundService`/`ChatService.handleSlackEvent` — por isso abre sua própria transação.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runner: TransactionRunner,
    private readonly events: DomainEvents,
    private readonly repository: BillingRepository,
  ) {}

  async handle(rawBody: string, signatureHeader: string | undefined): Promise<WebhookResult> {
    if (!verifyStripeSignature(this.config.STRIPE_WEBHOOK_SECRET, rawBody, signatureHeader)) {
      throw new UnauthorizedError('stripe_signature_invalid', 'Assinatura do webhook inválida.');
    }
    const parsedBody: unknown = JSON.parse(rawBody);
    const parsed = StripeEventSchema.safeParse(parsedBody);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
        'Corpo do evento do Stripe em formato inesperado.',
      );
    }
    const event = parsed.data;
    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event.type, event.data.object);
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdated(event.type, event.data.object);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event.type, event.data.object);
      case 'invoice.paid':
        return this.handleInvoice(event.type, event.data.object, 'paid');
      case 'invoice.payment_failed':
        return this.handleInvoice(event.type, event.data.object, 'failed');
      default:
        this.logger.debug({ eventType: event.type }, 'Evento do Stripe ignorado (não tratado)');
        return { received: true, handled: false, eventType: event.type };
    }
  }

  private async resolveTenantId(
    tenantIdFromMetadata: string | undefined,
    customerId: string | null | undefined,
    subscriptionId: string | null | undefined,
  ): Promise<string | null> {
    if (tenantIdFromMetadata !== undefined) return tenantIdFromMetadata;
    const resolved = await this.repository.resolveTenantByStripeIds(
      customerId ?? null,
      subscriptionId ?? null,
    );
    return resolved?.tenantId ?? null;
  }

  private async handleCheckoutCompleted(eventType: string, raw: unknown): Promise<WebhookResult> {
    const session = CheckoutSessionObjectSchema.parse(raw);
    const tenantId = await this.resolveTenantId(
      session.metadata?.tenantId,
      session.customer,
      session.subscription,
    );
    if (tenantId === null) {
      this.logger.warn({ sessionId: session.id }, 'checkout.session.completed sem tenant resolvível');
      return { received: true, handled: false, eventType };
    }
    const plan = session.metadata?.plan;
    const resolvedPlan: PlanTier | undefined = plan !== undefined && isPlanTier(plan) ? plan : undefined;
    await this.runner.run({ tenantId, userId: null, actorKind: 'system' }, async () => {
      const tx = this.runner.tx;
      const before = await this.repository.loadSubscriptionForUpdate(tx, tenantId);
      const updated = await this.repository.applyPatch(tx, tenantId, {
        ...(resolvedPlan === undefined ? {} : { plan: resolvedPlan }),
        status: 'active',
        paymentMethod: 'card',
        stripeCustomerId: session.customer ?? before?.stripeCustomerId ?? null,
        stripeSubscriptionId: session.subscription ?? before?.stripeSubscriptionId ?? null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
      });
      this.events.recordChange({
        action: 'billing.checkout_completed',
        entityType: 'subscription',
        entityId: updated.id,
        before: { plan: before?.plan ?? 'free' },
        after: { plan: updated.plan, stripeSubscriptionId: updated.stripeSubscriptionId },
      });
    });
    return { received: true, handled: true, eventType };
  }

  private async handleSubscriptionUpdated(eventType: string, raw: unknown): Promise<WebhookResult> {
    const sub = SubscriptionObjectSchema.parse(raw);
    const tenantId = await this.resolveTenantId(sub.metadata?.tenantId, sub.customer, sub.id);
    if (tenantId === null) {
      this.logger.warn({ subscriptionId: sub.id }, 'customer.subscription.updated sem tenant resolvível');
      return { received: true, handled: false, eventType };
    }
    const plan = sub.metadata?.plan;
    const resolvedPlan: PlanTier | undefined = plan !== undefined && isPlanTier(plan) ? plan : undefined;
    const status = STRIPE_STATUS_MAP[sub.status] ?? 'incomplete';
    await this.runner.run({ tenantId, userId: null, actorKind: 'system' }, async () => {
      const tx = this.runner.tx;
      const before = await this.repository.loadSubscriptionForUpdate(tx, tenantId);
      const updated = await this.repository.applyPatch(tx, tenantId, {
        ...(resolvedPlan === undefined ? {} : { plan: resolvedPlan }),
        status,
        paymentMethod: 'card',
        stripeCustomerId: sub.customer,
        stripeSubscriptionId: sub.id,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        ...(sub.current_period_start === undefined
          ? {}
          : { currentPeriodStart: new Date(sub.current_period_start * 1_000) }),
        ...(sub.current_period_end === undefined
          ? {}
          : { currentPeriodEnd: new Date(sub.current_period_end * 1_000) }),
      });
      this.events.recordChange({
        action: 'billing.subscription_updated',
        entityType: 'subscription',
        entityId: updated.id,
        before: { status: before?.status ?? 'none' },
        after: { status: updated.status, cancelAtPeriodEnd: updated.cancelAtPeriodEnd },
      });
    });
    return { received: true, handled: true, eventType };
  }

  private async handleSubscriptionDeleted(eventType: string, raw: unknown): Promise<WebhookResult> {
    const sub = SubscriptionObjectSchema.parse(raw);
    const tenantId = await this.resolveTenantId(sub.metadata?.tenantId, sub.customer, sub.id);
    if (tenantId === null) {
      this.logger.warn({ subscriptionId: sub.id }, 'customer.subscription.deleted sem tenant resolvível');
      return { received: true, handled: false, eventType };
    }
    await this.runner.run({ tenantId, userId: null, actorKind: 'system' }, async () => {
      const tx = this.runner.tx;
      const before = await this.repository.loadSubscriptionForUpdate(tx, tenantId);
      const updated = await this.repository.applyPatch(tx, tenantId, {
        plan: 'free',
        status: 'canceled',
        cancelAtPeriodEnd: false,
        canceledAt: new Date(),
      });
      this.events.recordChange({
        action: 'billing.subscription_deleted',
        entityType: 'subscription',
        entityId: updated.id,
        before: { plan: before?.plan ?? 'free' },
        after: { plan: updated.plan },
      });
    });
    return { received: true, handled: true, eventType };
  }

  private async handleInvoice(
    eventType: string,
    raw: unknown,
    outcome: 'paid' | 'failed',
  ): Promise<WebhookResult> {
    const invoice = InvoiceObjectSchema.parse(raw);
    const tenantId = await this.resolveTenantId(undefined, invoice.customer, invoice.subscription);
    if (tenantId === null) {
      this.logger.warn({ invoiceId: invoice.id }, 'Evento de fatura do Stripe sem tenant resolvível');
      return { received: true, handled: false, eventType };
    }
    const amountCents = outcome === 'paid' ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0);
    const now = new Date();
    await this.runner.run({ tenantId, userId: null, actorKind: 'system' }, async () => {
      const tx = this.runner.tx;
      const subscription = await this.repository.loadSubscriptionForUpdate(tx, tenantId);
      if (subscription === null) return;
      const paymentRecordId = await this.repository.insertPaymentRecord(tx, {
        tenantId,
        subscriptionId: subscription.id,
        amount: (amountCents / 100).toFixed(2),
        currency: (invoice.currency ?? 'brl').toUpperCase(),
        status: outcome === 'paid' ? 'paid' : 'failed',
        method: 'card',
        providerReferenceId: invoice.id,
        description: `Fatura Stripe ${invoice.id}`,
        paidAt: outcome === 'paid' ? now : null,
        createdBy: null,
      });
      if (outcome === 'paid' && subscription.status === 'past_due') {
        await this.repository.applyPatch(tx, tenantId, { status: 'active' });
      } else if (outcome === 'failed') {
        await this.repository.applyPatch(tx, tenantId, { status: 'past_due' });
      }
      this.events.recordChange({
        action: outcome === 'paid' ? 'billing.invoice_paid' : 'billing.invoice_payment_failed',
        entityType: 'payment_record',
        entityId: paymentRecordId,
        after: { amount: (amountCents / 100).toFixed(2), stripeInvoiceId: invoice.id },
      });
    });
    return { received: true, handled: true, eventType };
  }
}
