import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  PLAN_CATALOG,
  type CreateCheckoutSessionBody,
  type PaymentRecordDto,
  type PlanDefinition,
  type SubscriptionDto,
  type Usage,
} from '@cube-track/shared';
import { eq } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ConflictError, NotImplementedError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { BillingRepository, type SubscriptionRow } from '../infrastructure/billing.repository.js';
import {
  PAYMENT_METHOD_ADAPTERS,
  STRIPE_CLIENT,
  type PaymentCheckoutResult,
  type PaymentMethodAdapter,
  type StripeClient,
} from './ports.js';

const { tenants, users } = schema;

/** Período de cobrança simulado para o adaptador stub Pix/boleto (30 dias corridos — ver
 * `docs/billing.md` §5; o Stripe real informa o período exato via webhook). */
const STUB_BILLING_PERIOD_MS = 30 * 86_400_000;

export interface SubscriptionOverviewDto {
  subscription: SubscriptionDto;
  usage: Usage;
  plan: PlanDefinition;
}

function toSubscriptionDto(row: SubscriptionRow): SubscriptionDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    plan: row.plan,
    status: row.status,
    paymentMethod: row.paymentMethod,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Caso de uso de billing (ADR 0059): visão da assinatura/uso do tenant, checkout (cartão via Stripe
 * real, Pix/boleto via adaptador stub) e cancelamento. Toda operação exige `tenant.billing`
 * (permissão de tenant já existente, concedida por padrão ao papel `owner`/`admin`) — ver
 * `docs/billing.md` §3 sobre a ausência de um conceito de operador de PLATAFORMA (cross-tenant)
 * neste projeto hoje: "admin" aqui é sempre o admin DO PRÓPRIO tenant.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runner: TransactionRunner,
    private readonly events: DomainEvents,
    private readonly access: AccessService,
    private readonly repository: BillingRepository,
    @Inject(STRIPE_CLIENT) private readonly stripe: StripeClient,
    @Inject(PAYMENT_METHOD_ADAPTERS) private readonly adapters: PaymentMethodAdapter[],
  ) {}

  async overview(user: AuthPrincipal): Promise<SubscriptionOverviewDto> {
    await this.access.assert(user, 'tenant.billing', { type: 'tenant' });
    const tx = this.runner.tx;
    const row = await this.repository.loadSubscription(tx, user.tenantId);
    if (row === null) throw new Error(`Tenant ${user.tenantId} sem linha de assinatura (provisionamento incompleto)`);
    const [seats, storageBytes] = await Promise.all([
      this.repository.countSeats(tx, user.tenantId),
      this.repository.sumStorageBytes(tx, user.tenantId),
    ]);
    return {
      subscription: toSubscriptionDto(row),
      usage: { seats, storageBytes },
      plan: PLAN_CATALOG[row.plan],
    };
  }

  /** Lista as faturas/cobranças mais recentes da assinatura do tenant (histórico, mais recente primeiro). */
  async listPayments(user: AuthPrincipal, limit = 50): Promise<PaymentRecordDto[]> {
    await this.access.assert(user, 'tenant.billing', { type: 'tenant' });
    const tx = this.runner.tx;
    const rows = await tx
      .select()
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.tenantId, user.tenantId))
      .orderBy(schema.paymentRecords.issuedAt)
      .limit(limit);
    return rows
      .map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        method: row.method,
        providerReferenceId: row.providerReferenceId,
        description: row.description,
        issuedAt: row.issuedAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
      }))
      .reverse();
  }

  /**
   * Cria o checkout da mudança de plano: cartão (Stripe real) devolve uma URL de redirecionamento e
   * NÃO altera a assinatura ainda — a ativação vem do webhook (`checkout.session.completed`). Pix/
   * boleto (adaptador stub, lacuna documentada em `docs/billing.md` §5) não tem confirmação real de
   * pagamento possível neste ambiente, então ativa o plano imediatamente, registrando a cobrança já
   * como `paid`.
   */
  async checkout(user: AuthPrincipal, input: CreateCheckoutSessionBody): Promise<PaymentCheckoutResult> {
    await this.access.assert(user, 'tenant.billing', { type: 'tenant' });
    if (input.plan === 'free') {
      throw new ValidationError([
        { path: 'body.plan', message: 'O plano Free não passa por checkout — use o cancelamento.' },
      ]);
    }
    const tx = this.runner.tx;
    const subscription = await this.repository.loadSubscriptionForUpdate(tx, user.tenantId);
    const [tenantRow] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, user.tenantId));
    const [userRow] = await tx.select({ email: users.email }).from(users).where(eq(users.id, user.userId));
    if (tenantRow === undefined || userRow === undefined) {
      throw new Error('Tenant ou usuário não encontrado para o checkout.');
    }
    const definition = PLAN_CATALOG[input.plan];
    const adapter = this.adapters.find((candidate) => candidate.supports(input.method));
    if (adapter === undefined) {
      throw new NotImplementedError(`Método de pagamento "${input.method}" não suportado.`);
    }
    const appUrl = this.config.APP_URL;
    const result = await adapter.createCheckout(input.method, {
      tenantId: user.tenantId,
      tenantName: tenantRow.name,
      customerEmail: userRow.email,
      plan: input.plan,
      priceBRL: definition.priceBRL,
      existingStripeCustomerId: subscription?.stripeCustomerId ?? null,
      successUrl: `${appUrl}/settings/billing?checkout=success`,
      cancelUrl: `${appUrl}/settings/billing?checkout=canceled`,
    });
    if (result.kind === 'redirect') {
      this.events.recordChange({
        action: 'billing.checkout_started',
        entityType: 'subscription',
        entityId: subscription?.id ?? null,
        after: { plan: input.plan, method: input.method },
      });
      return result;
    }
    // Pix/boleto (stub): sem confirmação real possível — ativa de imediato (ver docs/billing.md §5).
    const now = new Date();
    const updated = await this.repository.applyPatch(tx, user.tenantId, {
      plan: input.plan,
      status: 'active',
      paymentMethod: input.method,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + STUB_BILLING_PERIOD_MS),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    });
    await this.repository.insertPaymentRecord(tx, {
      tenantId: user.tenantId,
      subscriptionId: updated.id,
      amount: definition.priceBRL,
      currency: 'BRL',
      status: 'paid',
      method: input.method,
      providerReferenceId: result.referenceId,
      description: `Assinatura plano ${definition.label} via ${input.method} (adaptador stub)`,
      paidAt: now,
      createdBy: user.userId,
    });
    this.events.recordChange({
      action: 'billing.plan_changed',
      entityType: 'subscription',
      entityId: updated.id,
      before: { plan: subscription?.plan ?? 'free' },
      after: { plan: input.plan, method: input.method },
    });
    return result;
  }

  /** Cancela a assinatura paga corrente. Cartão: agenda no Stripe para o fim do período já pago.
   * Pix/boleto (sem recorrência real): some imediatamente se o período simulado já venceu, ou agenda
   * para o fim dele quando ainda vigente. */
  async cancel(user: AuthPrincipal): Promise<SubscriptionDto> {
    await this.access.assert(user, 'tenant.billing', { type: 'tenant' });
    const tx = this.runner.tx;
    const subscription = await this.repository.loadSubscriptionForUpdate(tx, user.tenantId);
    if (subscription === null || subscription.plan === 'free') {
      throw new ConflictError('Não há assinatura paga para cancelar.', 'no_active_subscription');
    }
    let updated: SubscriptionRow;
    if (subscription.paymentMethod === 'card' && subscription.stripeSubscriptionId !== null) {
      await this.stripe.cancelSubscriptionAtPeriodEnd(subscription.stripeSubscriptionId);
      updated = await this.repository.applyPatch(tx, user.tenantId, { cancelAtPeriodEnd: true });
    } else {
      const stillWithinPeriod =
        subscription.currentPeriodEnd !== null && subscription.currentPeriodEnd.getTime() > Date.now();
      updated = stillWithinPeriod
        ? await this.repository.applyPatch(tx, user.tenantId, { cancelAtPeriodEnd: true })
        : await this.repository.applyPatch(tx, user.tenantId, {
            plan: 'free',
            status: 'canceled',
            cancelAtPeriodEnd: false,
            canceledAt: new Date(),
          });
    }
    this.events.recordChange({
      action: 'billing.canceled',
      entityType: 'subscription',
      entityId: updated.id,
      before: { plan: subscription.plan, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd },
      after: { plan: updated.plan, cancelAtPeriodEnd: updated.cancelAtPeriodEnd, status: updated.status },
    });
    return toSubscriptionDto(updated);
  }

  /**
   * Override administrativo do plano (ADR 0059) — muda SÓ `plan`/`tenants.plan` (catálogo de
   * limites/módulos), sem tocar `status`/`paymentMethod`/Stripe. Uso: trial estendido pela área
   * comercial, correção manual de suporte. Nunca confundir com `cancel` (que de fato encerra a
   * cobrança) — ver `docs/billing.md` §3.
   */
  async overridePlan(user: AuthPrincipal, plan: SubscriptionDto['plan']): Promise<SubscriptionDto> {
    await this.access.assert(user, 'tenant.billing', { type: 'tenant' });
    const tx = this.runner.tx;
    const before = await this.repository.loadSubscriptionForUpdate(tx, user.tenantId);
    if (before === null) throw new Error(`Tenant ${user.tenantId} sem linha de assinatura.`);
    const updated = await this.repository.applyPatch(tx, user.tenantId, { plan });
    this.events.recordChange({
      action: 'billing.plan_overridden',
      entityType: 'subscription',
      entityId: updated.id,
      before: { plan: before.plan },
      after: { plan: updated.plan },
    });
    return toSubscriptionDto(updated);
  }
}
