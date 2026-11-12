import { Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { Endpoint } from '../../../core/http/endpoint.js';
import { StripeWebhookService } from '../application/stripe-webhook.service.js';
import { StripeWebhookResponse } from './schemas.js';

const RawEventBody = z.record(z.string(), z.unknown());

/**
 * Webhook público do Stripe (ADR 0059): sem sessão/Bearer (o Stripe não tem uma), autenticado pela
 * assinatura HMAC `Stripe-Signature` sobre o corpo BRUTO (`request.rawBody`, capturado em
 * `bootstrap.ts` antes do parse — mesmo mecanismo do Slack Events API/`ChatController`).
 */
@Controller('billing/stripe')
export class StripeWebhookController {
  constructor(private readonly webhook: StripeWebhookService) {}

  @Post('webhook')
  @Audited({ action: 'billing.stripe_webhook', entityType: 'subscription', transactional: false })
  @Endpoint({
    summary: 'Webhook do Stripe (checkout, assinatura e faturas)',
    description:
      'Público. Verifica `Stripe-Signature` (HMAC-SHA256, `verifyStripeSignature`). Trata ' +
      '`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid` e ' +
      '`invoice.payment_failed`; outros tipos são reconhecidos (200) e ignorados.',
    tags: ['public'],
    public: true,
    status: 200,
    body: RawEventBody,
    response: StripeWebhookResponse,
  })
  async receive(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() request: Request,
  ) {
    const rawBody = request.rawBody?.toString('utf8') ?? '';
    return this.webhook.handle(rawBody, signature);
  }
}
