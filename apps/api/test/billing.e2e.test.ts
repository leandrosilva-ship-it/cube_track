import { randomBytes } from 'node:crypto';

import { signStripePayload } from '@cube-track/shared/billing-webhook';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

const STRIPE_WEBHOOK_SECRET = 'whsec_test_0123456789abcdef';

interface Session {
  accessToken: string;
}
interface SubscriptionOverview {
  subscription: {
    plan: string;
    status: string;
    paymentMethod: string;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
  usage: { seats: number; storageBytes: number };
  plan: { tier: string; limits: { maxSeats: number | null } };
}
interface PaymentHistory {
  data: { status: string; method: string; amount: string; providerReferenceId: string | null }[];
}

async function signup(
  api: ApiClient,
  organizationSlug: string,
  email: string,
): Promise<{ token: string; tenantId: string }> {
  // `POST /v1/auth/signup` é limitado a 5/hora por IP (auth.controller.ts) — este arquivo faz vários
  // signups no mesmo IP de teste, então zera o limitador antes de cada um (mesmo padrão de
  // auth.e2e.test.ts).
  await resetRateLimits();
  const response = await api.post<Session>('/v1/auth/signup', {
    body: {
      name: 'Dono',
      email,
      password: 'Senha-Segura-2026',
      organizationName: organizationSlug,
      organizationSlug,
    },
  });
  expect(response.status).toBe(201);
  const token = response.body.accessToken;
  const me = await api.get<{ tenant: { id: string } }>('/v1/me', { token });
  return { token, tenantId: me.body.tenant.id };
}

/** Billing (ADR 0059): planos, checkout (Stripe real para cartão, adaptador stub para Pix/boleto),
 * webhook do Stripe e guarda de limite de vagas do plano. */
describe('Billing: planos, checkout, webhook e limite de vagas', () => {
  let server: ApiServer;
  let api: ApiClient;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    await resetRateLimits();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /v1/billing/subscription: tenant demo (Enterprise) não tem limites', async () => {
    const owner = await api.login(USERS.ana);
    const response = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token: owner });
    expect(response.status).toBe(200);
    expect(response.body.subscription.plan).toBe('enterprise');
    expect(response.body.plan.limits.maxSeats).toBeNull();
    expect(response.body.usage.seats).toBeGreaterThan(0);
  });

  it('apenas o papel "owner" tem `tenant.billing` — "admin" e "member" recebem 403', async () => {
    const adminToken = await api.login(USERS.carlos);
    const memberToken = await api.login(USERS.thiago);
    expect((await api.get('/v1/billing/subscription', { token: adminToken })).status).toBe(403);
    expect((await api.get('/v1/billing/subscription', { token: memberToken })).status).toBe(403);
  });

  it('checkout por Pix (adaptador stub) ativa o plano de imediato e registra a cobrança paga', async () => {
    const suffix = randomBytes(4).toString('hex');
    const { token } = await signup(api, `pix-org-${suffix}`, `dono.pix.${suffix}@exemplo.com`);

    const checkout = await api.post<{ kind: string; method: string; qrPayload: string; referenceId: string }>(
      '/v1/billing/checkout',
      { token, body: { plan: 'business', method: 'pix' } },
    );
    expect(checkout.status).toBe(201);
    expect(checkout.body.kind).toBe('pix');
    expect(checkout.body.method).toBe('pix');
    expect(checkout.body.qrPayload).toContain('FAKE-PIX');
    expect(checkout.body.referenceId).toContain('fake_pix_');

    const overview = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token });
    expect(overview.body.subscription).toMatchObject({
      plan: 'business',
      status: 'active',
      paymentMethod: 'pix',
      cancelAtPeriodEnd: false,
    });

    const payments = await api.get<PaymentHistory>('/v1/billing/payments', { token });
    expect(payments.body.data).toHaveLength(1);
    expect(payments.body.data[0]).toMatchObject({
      status: 'paid',
      method: 'pix',
      providerReferenceId: checkout.body.referenceId,
    });
    expect(Number(payments.body.data[0]?.amount)).toBeCloseTo(149.9, 4);
  });

  it('checkout por boleto (adaptador stub) gera uma linha claramente falsa', async () => {
    const suffix = randomBytes(4).toString('hex');
    const { token } = await signup(api, `boleto-org-${suffix}`, `dono.boleto.${suffix}@exemplo.com`);
    const checkout = await api.post<{ kind: string; barcode: string }>('/v1/billing/checkout', {
      token,
      body: { plan: 'pro', method: 'boleto' },
    });
    expect(checkout.status).toBe(201);
    expect(checkout.body.kind).toBe('boleto');
    expect(checkout.body.barcode).toMatch(/^FAKE-BOLETO-/);
  });

  it('checkout rejeita plano Free (não passa por cobrança)', async () => {
    const suffix = randomBytes(4).toString('hex');
    const { token } = await signup(api, `free-org-${suffix}`, `dono.free.${suffix}@exemplo.com`);
    const checkout = await api.post('/v1/billing/checkout', { token, body: { plan: 'free', method: 'pix' } });
    expect(checkout.status).toBe(400);
  });

  it('cancelamento agenda o fim para o término do período já pago (nunca cancela de imediato)', async () => {
    const suffix = randomBytes(4).toString('hex');
    const { token } = await signup(api, `cancel-org-${suffix}`, `dono.cancel.${suffix}@exemplo.com`);
    await api.post('/v1/billing/checkout', { token, body: { plan: 'pro', method: 'pix' } });

    const canceled = await api.post<{ plan: string; cancelAtPeriodEnd: boolean; status: string }>(
      '/v1/billing/cancel',
      { token },
    );
    expect(canceled.status).toBe(200);
    expect(canceled.body).toMatchObject({ plan: 'pro', cancelAtPeriodEnd: true, status: 'active' });

    const noSubscriptionToCancel = await api.post('/v1/billing/cancel', { token });
    expect(noSubscriptionToCancel.status).toBe(200); // ainda "pro" com cancelAtPeriodEnd — idempotente
  });

  it('cancelar sem assinatura paga (plano Free) devolve 409', async () => {
    const suffix = randomBytes(4).toString('hex');
    const { token } = await signup(api, `nosub-org-${suffix}`, `dono.nosub.${suffix}@exemplo.com`);
    const response = await api.post('/v1/billing/cancel', { token });
    expect(response.status).toBe(409);
  });

  it('override administrativo muda só o plano, sem tocar status/forma de pagamento', async () => {
    const suffix = randomBytes(4).toString('hex');
    const { token } = await signup(api, `override-org-${suffix}`, `dono.override.${suffix}@exemplo.com`);
    const before = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token });
    expect(before.body.subscription.plan).toBe('free');

    const override = await api.post<{ plan: string; status: string; paymentMethod: string }>(
      '/v1/billing/plan/override',
      { token, body: { plan: 'business' } },
    );
    expect(override.status).toBe(200);
    expect(override.body.plan).toBe('business');
    // Status/forma de pagamento permanecem os do plano Free (nunca cobrado) — override não é checkout.
    expect(override.body.status).toBe('none');
    expect(override.body.paymentMethod).toBe('none');
  });

  describe('Webhook do Stripe (assinatura HMAC + resolução de tenant por metadata/id)', () => {
    async function post(event: unknown, secret = STRIPE_WEBHOOK_SECRET) {
      const rawBody = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = signStripePayload(secret, rawBody, timestamp);
      return api.post<{ received: boolean; handled: boolean; eventType: string }>(
        '/v1/billing/stripe/webhook',
        { body: event, headers: { 'stripe-signature': signature } },
      );
    }

    it('checkout.session.completed com assinatura válida ativa o plano e grava os ids do Stripe', async () => {
      const suffix = randomBytes(4).toString('hex');
      const { token, tenantId } = await signup(api, `webhook-org-${suffix}`, `dono.webhook.${suffix}@exemplo.com`);
      const customerId = `cus_test_${suffix}`;
      const subscriptionId = `sub_test_${suffix}`;

      const response = await post({
        id: `evt_checkout_${suffix}`,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: `cs_test_${suffix}`,
            customer: customerId,
            subscription: subscriptionId,
            metadata: { tenantId, plan: 'pro' },
          },
        },
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ received: true, handled: true });

      const overview = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token });
      expect(overview.body.subscription).toMatchObject({
        plan: 'pro',
        status: 'active',
        paymentMethod: 'card',
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
      });

      // customer.subscription.updated (sem metadata.tenantId — resolvido por
      // app.resolve_subscription_by_stripe_id, pelos ids já gravados acima).
      const updated = await post({
        id: `evt_sub_updated_${suffix}`,
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: subscriptionId,
            customer: customerId,
            status: 'past_due',
            cancel_at_period_end: false,
          },
        },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.handled).toBe(true);
      const afterPastDue = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token });
      expect(afterPastDue.body.subscription.status).toBe('past_due');

      // invoice.paid (mesma resolução por id, sem metadata) devolve o status para "active".
      const paid = await post({
        id: `evt_invoice_paid_${suffix}`,
        type: 'invoice.paid',
        data: {
          object: { id: `in_test_${suffix}`, customer: customerId, subscription: subscriptionId, amount_paid: 4990, currency: 'brl' },
        },
      });
      expect(paid.status).toBe(200);
      const afterPaid = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token });
      expect(afterPaid.body.subscription.status).toBe('active');
      const payments = await api.get<PaymentHistory>('/v1/billing/payments', { token });
      expect(payments.body.data.some((entry) => entry.providerReferenceId === `in_test_${suffix}` && entry.status === 'paid')).toBe(true);

      // customer.subscription.deleted encerra a assinatura e devolve ao Free.
      const deleted = await post({
        id: `evt_sub_deleted_${suffix}`,
        type: 'customer.subscription.deleted',
        data: { object: { id: subscriptionId, customer: customerId, status: 'canceled' } },
      });
      expect(deleted.status).toBe(200);
      const afterDeleted = await api.get<SubscriptionOverview>('/v1/billing/subscription', { token });
      expect(afterDeleted.body.subscription).toMatchObject({ plan: 'free', status: 'canceled' });
    });

    it('rejeita uma assinatura adulterada (corpo mudou depois de assinado)', async () => {
      const rawBody = JSON.stringify({
        id: 'evt_tamper',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_tamper', customer: 'cus_x', subscription: 'sub_x', metadata: {} } },
      });
      const timestamp = Math.floor(Date.now() / 1_000);
      const signature = signStripePayload(STRIPE_WEBHOOK_SECRET, rawBody, timestamp);
      const tampered = {
        id: 'evt_tamper',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_tamper', customer: 'cus_y', subscription: 'sub_y', metadata: {} } },
      };
      const response = await api.post('/v1/billing/stripe/webhook', {
        body: tampered,
        headers: { 'stripe-signature': signature },
      });
      expect(response.status).toBe(401);
    });

    it('rejeita um segredo de assinatura errado', async () => {
      const response = await post(
        {
          id: 'evt_wrong_secret',
          type: 'checkout.session.completed',
          data: { object: { id: 'cs_z', customer: null, subscription: null, metadata: {} } },
        },
        'whsec_outro_segredo_0123456789',
      );
      expect(response.status).toBe(401);
    });

    it('evento não tratado é reconhecido (200) e marcado como não processado', async () => {
      const response = await post({ id: 'evt_unhandled', type: 'customer.updated', data: { object: {} } });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ received: true, handled: false, eventType: 'customer.updated' });
    });
  });

  describe('Limite de vagas do plano (ADR 0059)', () => {
    it('plano Free (5 vagas): a 5ª vaga adicional é recusada com 409 seat_limit_exceeded', async () => {
      const suffix = randomBytes(4).toString('hex');
      const { token } = await signup(api, `seats-org-${suffix}`, `dono.seats.${suffix}@exemplo.com`);
      const roles = await api.get<{ data: { id: string; key: string; scope: string }[] }>('/v1/roles', {
        token,
      });
      const memberRoleId = roles.body.data.find((role) => role.scope === 'tenant' && role.key === 'member')?.id;
      expect(memberRoleId).toBeDefined();

      // Dono já ocupa 1 vaga; plano Free permite 5 — cabem 4 convites de membro.
      for (let index = 0; index < 4; index += 1) {
        const response = await api.post('/v1/invitations', {
          token,
          body: { email: `convidado.${index}.${suffix}@exemplo.com`, roleId: memberRoleId, kind: 'member' },
        });
        expect(response.status).toBe(201);
      }
      const overLimit = await api.post('/v1/invitations', {
        token,
        body: { email: `convidado.excesso.${suffix}@exemplo.com`, roleId: memberRoleId, kind: 'member' },
      });
      expect(overLimit.status).toBe(409);
      expect((overLimit.body as { code?: string }).code).toBe('seat_limit_exceeded');
    });

    it('override para Enterprise remove o limite de vagas (convite além de 5 passa a funcionar)', async () => {
      const suffix = randomBytes(4).toString('hex');
      const { token } = await signup(api, `seats-ent-${suffix}`, `dono.seatsent.${suffix}@exemplo.com`);
      await api.post('/v1/billing/plan/override', { token, body: { plan: 'enterprise' } });
      const roles = await api.get<{ data: { id: string; key: string; scope: string }[] }>('/v1/roles', {
        token,
      });
      const memberRoleId = roles.body.data.find((role) => role.scope === 'tenant' && role.key === 'member')?.id;
      for (let index = 0; index < 6; index += 1) {
        const response = await api.post('/v1/invitations', {
          token,
          body: { email: `convidado.ent.${index}.${suffix}@exemplo.com`, roleId: memberRoleId, kind: 'member' },
        });
        expect(response.status).toBe(201);
      }
    });
  });
});
