import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant, type DatabaseHandle } from '../src/client.js';
import { subscriptions, tenants } from '../src/schema/index.js';
import { DEMO_TENANT_ID } from '../src/seed/context.js';
import { appDatabase, createSmallTenant, ensureDemo } from './helpers.js';

describe('Provisionamento de billing (ADR 0059)', () => {
  let app: DatabaseHandle;

  beforeAll(async () => {
    app = appDatabase();
    await ensureDemo(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  it('um tenant novo nasce no plano Free, com uma linha de assinatura sem cobrança', async () => {
    const tenant = await createSmallTenant(app.db, `billing-${Date.now()}`);
    await withTenant(app.db, { tenantId: tenant.tenantId }, async (tx) => {
      const [row] = await tx.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenant.tenantId));
      expect(row?.plan).toBe('free');
      const [subscription] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenant.tenantId));
      expect(subscription?.plan).toBe('free');
      expect(subscription?.status).toBe('none');
      expect(subscription?.paymentMethod).toBe('none');
      expect(subscription?.stripeCustomerId).toBeNull();
    });
  });

  it('o tenant de demonstração é Enterprise explicitamente (não sujeito aos limites do Free)', async () => {
    await withTenant(app.db, { tenantId: DEMO_TENANT_ID }, async (tx) => {
      const [row] = await tx.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, DEMO_TENANT_ID));
      expect(row?.plan).toBe('enterprise');
      const [subscription] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, DEMO_TENANT_ID));
      expect(subscription?.plan).toBe('enterprise');
    });
  });
});
