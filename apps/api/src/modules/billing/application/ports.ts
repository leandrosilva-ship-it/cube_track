import type { PaymentMethod, PlanTier } from '@cube-track/shared';

/**
 * Porta de baixo nível para a API real do Stripe (ADR 0059) — seam injetável para permitir testar a
 * lógica própria (`BillingService`, `StripeAdapter`) sem credenciais reais. `StripeSdkClient`
 * (infrastructure) é a implementação real com o SDK `stripe`; `FakeStripeClient` (usado nos testes)
 * implementa a mesma porta de forma determinística, sem rede.
 *
 * **Lacuna documentada (`docs/billing.md`)**: nenhuma chamada real ao Stripe foi exercitada nesta
 * sessão — não há chave de teste do Stripe disponível neste sandbox. A integração foi escrita
 * contra as formas documentadas do SDK (`stripe.checkout.sessions.create`,
 * `stripe.subscriptions.update/cancel`) e testada apenas via esta porta com um fake determinístico.
 */
export interface StripeCheckoutSessionInput {
  /** Cliente Stripe já existente (assinatura anterior cancelada) ou `null` (primeiro checkout). */
  customerId: string | null;
  customerEmail: string;
  tenantName: string;
  plan: PlanTier;
  /** Preço do plano em BRL (decimal string, CLAUDE.md §5) — convertido para centavos aqui dentro. */
  priceBRL: string;
  successUrl: string;
  cancelUrl: string;
  /** Devolvido pelo Stripe em todo evento de webhook relativo a esta sessão/assinatura — é assim
   * que o webhook (sem sessão de usuário) resolve de volta o tenant, junto de
   * `app.resolve_subscription_by_stripe_id` (0038_billing_rls_and_resolver.sql). */
  metadata: { tenantId: string; plan: PlanTier };
}

export interface StripeCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface StripeClient {
  createCheckoutSession(input: StripeCheckoutSessionInput): Promise<StripeCheckoutSessionResult>;
  /** Agenda o cancelamento para o fim do período corrente já pago (nunca cancelamento imediato — o
   * cliente já pagou por esse período). */
  cancelSubscriptionAtPeriodEnd(subscriptionId: string): Promise<void>;
  /** Reverte um cancelamento agendado (o tenant mudou de ideia antes do fim do período). */
  resumeSubscription(subscriptionId: string): Promise<void>;
}

// -------------------------------------------------------------------- adaptador de pagamento ---

export interface PaymentCheckoutContext {
  tenantId: string;
  tenantName: string;
  customerEmail: string;
  plan: PlanTier;
  priceBRL: string;
  /** `stripeCustomerId` já associado ao tenant (assinatura Stripe anterior), quando existir. */
  existingStripeCustomerId: string | null;
  successUrl: string;
  cancelUrl: string;
}

export type PaymentCheckoutResult =
  | { method: 'card'; kind: 'redirect'; redirectUrl: string; stripeSessionId: string; stripeCustomerId: null }
  | {
      method: 'pix';
      kind: 'pix';
      /** Payload "Pix copia e cola" — determinístico e FALSO (nunca um PSP real, ver
       * `PixBoletoAdapter`). */
      qrPayload: string;
      referenceId: string;
      expiresAt: Date;
    }
  | {
      method: 'boleto';
      kind: 'boleto';
      /** Linha digitável — determinística e FALSA (nunca um PSP real, ver `PixBoletoAdapter`). */
      barcode: string;
      referenceId: string;
      dueAt: Date;
    };

/**
 * Forma de adaptador de meio de pagamento (ADR 0059) — não existia em `packages/shared/src/billing.ts`
 * (catálogo de planos é puro/síncrono; este tipo tem I/O), então definida aqui. Cada instância serve
 * um subconjunto de `PaymentMethod` (`supports`); `BillingService` escolhe o primeiro adaptador
 * registrado que atende o método pedido.
 */
export interface PaymentMethodAdapter {
  supports(method: PaymentMethod): boolean;
  createCheckout(
    method: Exclude<PaymentMethod, 'none'>,
    context: PaymentCheckoutContext,
  ): Promise<PaymentCheckoutResult>;
}

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');
export const PAYMENT_METHOD_ADAPTERS = Symbol('PAYMENT_METHOD_ADAPTERS');
