import { Controller, Get, Post } from '@nestjs/common';
import { CreateCheckoutSessionBodySchema, SubscriptionSchema } from '@cube-track/shared';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { BillingService } from '../application/billing.service.js';
import {
  CheckoutResultResponse,
  OverridePlanBody,
  PaymentHistoryResponse,
  SubscriptionOverviewResponse,
} from './schemas.js';

/**
 * Billing do próprio tenant (ADR 0059): visão de plano/uso, checkout (cartão via Stripe real, Pix/
 * boleto via adaptador stub), cancelamento e override administrativo do plano. Toda rota requer
 * `tenant.billing` (verificado em `BillingService`, não aqui — mesmo padrão de outros controllers
 * finos que delegam a checagem à camada de aplicação).
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('subscription')
  @Endpoint({
    summary: 'Ver o plano, status de assinatura e uso corrente do tenant',
    description: 'Requer `tenant.billing`.',
    tags: ['billing'],
    response: SubscriptionOverviewResponse,
  })
  overview(@CurrentPrincipal() user: AuthPrincipal) {
    return this.billing.overview(user);
  }

  @Get('payments')
  @Endpoint({
    summary: 'Histórico de cobranças da assinatura (mais recente primeiro)',
    description: 'Requer `tenant.billing`.',
    tags: ['billing'],
    response: PaymentHistoryResponse,
  })
  async payments(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.billing.listPayments(user) };
  }

  @Post('checkout')
  @Audited({ action: 'billing.checkout', entityType: 'subscription' })
  @Endpoint({
    summary: 'Iniciar o checkout de upgrade de plano (cartão, Pix ou boleto)',
    description:
      'Requer `tenant.billing`. Cartão devolve uma URL de redirecionamento ao Stripe (ativação só após ' +
      'o webhook confirmar o pagamento); Pix/boleto usam o adaptador stub (ADR 0059) e ativam o plano ' +
      'de imediato, sem PSP real — ver `docs/billing.md` §5.',
    tags: ['billing'],
    status: 201,
    body: CreateCheckoutSessionBodySchema,
    response: CheckoutResultResponse,
    errors: [400],
  })
  checkout(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof CreateCheckoutSessionBodySchema>,
  ) {
    return this.billing.checkout(user, body);
  }

  @Post('cancel')
  @Audited({ action: 'billing.cancel', entityType: 'subscription' })
  @Endpoint({
    summary: 'Cancelar a assinatura paga corrente',
    description: 'Requer `tenant.billing`. Agenda o fim para o término do período já pago (nunca cancela um período já cobrado).',
    tags: ['billing'],
    status: 200,
    response: SubscriptionSchema,
    errors: [409],
  })
  cancel(@CurrentPrincipal() user: AuthPrincipal) {
    return this.billing.cancel(user);
  }

  @Post('plan/override')
  @Audited({ action: 'billing.plan_override', entityType: 'subscription' })
  @Endpoint({
    summary: 'Override administrativo do plano (sem cobrança) — trial/correção de suporte',
    description:
      'Requer `tenant.billing`. Muda só o plano (catálogo de limites/módulos); nunca mexe em ' +
      'status/forma de pagamento/Stripe — ver `docs/billing.md` §3.',
    tags: ['billing'],
    status: 200,
    body: OverridePlanBody,
    response: SubscriptionSchema,
  })
  overridePlan(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof OverridePlanBody>,
  ) {
    return this.billing.overridePlan(user, body.plan);
  }
}
