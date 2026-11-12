import { Inject, Injectable } from '@nestjs/common';
import type { PaymentMethod } from '@cube-track/shared';

import {
  STRIPE_CLIENT,
  type PaymentCheckoutContext,
  type PaymentCheckoutResult,
  type PaymentMethodAdapter,
  type StripeClient,
} from '../application/ports.js';

/** Adaptador de cartão via Stripe de verdade (ADR 0059) — único método que passa pelo PSP real. */
@Injectable()
export class StripeAdapter implements PaymentMethodAdapter {
  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: StripeClient) {}

  supports(method: PaymentMethod): boolean {
    return method === 'card';
  }

  async createCheckout(
    method: Exclude<PaymentMethod, 'none'>,
    context: PaymentCheckoutContext,
  ): Promise<PaymentCheckoutResult> {
    if (method !== 'card') throw new Error(`StripeAdapter não trata o método "${method}"`);
    const session = await this.stripe.createCheckoutSession({
      customerId: context.existingStripeCustomerId,
      customerEmail: context.customerEmail,
      tenantName: context.tenantName,
      plan: context.plan,
      priceBRL: context.priceBRL,
      successUrl: context.successUrl,
      cancelUrl: context.cancelUrl,
      metadata: { tenantId: context.tenantId, plan: context.plan },
    });
    return {
      method: 'card',
      kind: 'redirect',
      redirectUrl: session.url,
      stripeSessionId: session.sessionId,
      stripeCustomerId: null,
    };
  }
}
