import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@cube-track/shared';
import Stripe from 'stripe';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { NotImplementedError } from '../../../core/errors/problems.js';
import type {
  StripeCheckoutSessionInput,
  StripeCheckoutSessionResult,
  StripeClient,
} from '../application/ports.js';

/**
 * Implementação real da porta `StripeClient` (ADR 0059), usando o SDK oficial `stripe` contra a API
 * de verdade do Stripe (modo de teste em dev/CI, com `STRIPE_SECRET_KEY=sk_test_...`).
 *
 * **Lacuna documentada (`docs/billing.md`)**: sem chave de teste do Stripe disponível neste sandbox,
 * nenhuma chamada real (`checkout.sessions.create`, `subscriptions.update/cancel`) foi exercitada
 * nesta sessão — só escrita contra as formas documentadas do SDK e testada via a porta `StripeClient`
 * com `FakeStripeClient` (testes). `createCheckoutSession` usa `price_data` inline (produto/preço
 * criados na hora da sessão) em vez de IDs de `Price` pré-cadastrados no painel do Stripe: evita uma
 * etapa manual de setup por plano, ao custo de não reutilizar o mesmo objeto `Price` entre sessões
 * (irrelevante para relatórios do Stripe nesta escala).
 */
@Injectable()
export class StripeSdkClient implements StripeClient {
  private readonly stripe: Stripe | null;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.stripe =
      config.STRIPE_SECRET_KEY === undefined
        ? null
        : new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2026-10-28.endive' });
  }

  private client(): Stripe {
    if (this.stripe === null) {
      throw new NotImplementedError(
        'Checkout por cartão (Stripe) não está configurado neste ambiente (STRIPE_SECRET_KEY ausente). Pix/boleto continuam disponíveis.',
      );
    }
    return this.stripe;
  }

  async createCheckoutSession(
    input: StripeCheckoutSessionInput,
  ): Promise<StripeCheckoutSessionResult> {
    const unitAmount = new Decimal(input.priceBRL).times(100).toNumber();
    const session = await this.client().checkout.sessions.create({
      mode: 'subscription',
      ...(input.customerId === null
        ? { customer_email: input.customerEmail }
        : { customer: input.customerId }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: unitAmount,
            recurring: { interval: 'month' },
            product_data: {
              name: `CUBE TRACK — Plano ${input.plan}`,
              metadata: { tenantId: input.metadata.tenantId },
            },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.metadata.tenantId,
      subscription_data: { metadata: input.metadata },
      metadata: input.metadata,
    });
    if (session.url === null) {
      throw new NotImplementedError('O Stripe não retornou uma URL de checkout.');
    }
    return { sessionId: session.id, url: session.url };
  }

  async cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void> {
    await this.client().subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }

  async resumeSubscription(subscriptionId: string): Promise<void> {
    await this.client().subscriptions.update(subscriptionId, { cancel_at_period_end: false });
  }
}
