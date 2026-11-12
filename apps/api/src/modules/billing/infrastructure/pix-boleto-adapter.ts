import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Decimal, type PaymentMethod } from '@cube-track/shared';

import type {
  PaymentCheckoutContext,
  PaymentCheckoutResult,
  PaymentMethodAdapter,
} from '../application/ports.js';

const PIX_EXPIRY_MS = 30 * 60_000;
const BOLETO_DUE_MS = 3 * 86_400_000;

/**
 * Adaptador Pix/boleto (ADR 0059) — **lacuna documentada e deliberada** (`docs/billing.md` §5):
 * NUNCA chama um PSP real (não há integração com nenhum Pix Service Provider/banco emissor de
 * boleto neste projeto). Gera um payload/linha digitável claramente falso (prefixo `FAKE-PIX-` ou
 * `FAKE-BOLETO-`, nunca um EMV/código de barras válido de verdade) de forma determinística — mesmo
 * tenant/plano/dia produz o mesmo `referenceId`, o que também dá idempotência "de graça" ao registro
 * de cobrança (`payment_records` tem `UNIQUE (tenant_id, provider_reference_id)`). A confirmação do
 * pagamento é manual nesta entrega: não há como um usuário real "pagar" este Pix/boleto fake, então
 * `BillingService` marca a assinatura como `status: 'active'` no mesmo request que cria a cobrança
 * (ver `docs/billing.md`), diferente do cartão (que só confirma via webhook assíncrono do Stripe).
 */
@Injectable()
export class PixBoletoAdapter implements PaymentMethodAdapter {
  supports(method: PaymentMethod): boolean {
    return method === 'pix' || method === 'boleto';
  }

  createCheckout(
    method: Exclude<PaymentMethod, 'none'>,
    context: PaymentCheckoutContext,
  ): Promise<PaymentCheckoutResult> {
    if (method !== 'pix' && method !== 'boleto') {
      throw new Error(`PixBoletoAdapter não trata o método "${method}"`);
    }
    const day = new Date().toISOString().slice(0, 10);
    const seed = `${context.tenantId}:${method}:${context.plan}:${day}`;
    const digest = createHash('sha256').update(seed).digest('hex');
    const referenceId = `fake_${method}_${digest.slice(0, 24)}`;
    const amountCents = new Decimal(context.priceBRL).times(100).toFixed(0);
    if (method === 'pix') {
      return Promise.resolve({
        method: 'pix',
        kind: 'pix',
        qrPayload: `FAKE-PIX-COPIA-COLA|ref=${referenceId}|valor=${amountCents}|tenant=${context.tenantId}`,
        referenceId,
        expiresAt: new Date(Date.now() + PIX_EXPIRY_MS),
      });
    }
    return Promise.resolve({
      method: 'boleto',
      kind: 'boleto',
      // Deliberadamente NÃO somente dígitos (uma linha digitável real tem só dígitos) — o prefixo
      // garante que isto nunca seja confundido com um código de barras válido de verdade.
      barcode: `FAKE-BOLETO-${digest.slice(0, 40)}`,
      referenceId,
      dueAt: new Date(Date.now() + BOLETO_DUE_MS),
    });
  }
}
