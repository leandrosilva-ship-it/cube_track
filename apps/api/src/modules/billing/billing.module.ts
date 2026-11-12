import { Module } from '@nestjs/common';

import { BillingService } from './application/billing.service.js';
import { PAYMENT_METHOD_ADAPTERS, STRIPE_CLIENT, type PaymentMethodAdapter } from './application/ports.js';
import { SeatLimitService } from './application/seat-limit.service.js';
import { StripeWebhookService } from './application/stripe-webhook.service.js';
import { BillingRepository } from './infrastructure/billing.repository.js';
import { PixBoletoAdapter } from './infrastructure/pix-boleto-adapter.js';
import { StripeAdapter } from './infrastructure/stripe-adapter.js';
import { StripeSdkClient } from './infrastructure/stripe-sdk.client.js';
import { BillingController } from './presentation/billing.controller.js';
import { StripeWebhookController } from './presentation/stripe-webhook.controller.js';

/**
 * Billing (ADR 0059): planos Free/Pro/Business/Enterprise, checkout Stripe (cartão) + adaptador
 * stub Pix/boleto, webhook público e guarda de limite de vagas (`SeatLimitService`, exportado para
 * o módulo de identidade usar no fluxo de convite — único ponto de acoplamento entre os dois
 * módulos, pela API pública, como o CLAUDE.md §5 pede).
 */
@Module({
  controllers: [BillingController, StripeWebhookController],
  providers: [
    BillingRepository,
    BillingService,
    SeatLimitService,
    StripeWebhookService,
    StripeAdapter,
    PixBoletoAdapter,
    { provide: STRIPE_CLIENT, useClass: StripeSdkClient },
    {
      provide: PAYMENT_METHOD_ADAPTERS,
      useFactory: (stripeAdapter: StripeAdapter, pixBoletoAdapter: PixBoletoAdapter): PaymentMethodAdapter[] => [
        stripeAdapter,
        pixBoletoAdapter,
      ],
      inject: [StripeAdapter, PixBoletoAdapter],
    },
  ],
  exports: [SeatLimitService],
})
export class BillingModule {}
