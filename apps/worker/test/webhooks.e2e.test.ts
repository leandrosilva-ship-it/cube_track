import { createHmac, randomBytes } from 'node:crypto';

import { schema, type DatabaseHandle } from '@cube-track/db';
import { encryptSecret, newId } from '@cube-track/shared';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { webhookDeliveryProcessor, webhookFanoutProcessor } from '../src/processors/webhooks.js';
import { adminDb, appDb, demoContext, domainEvent, fakeJob, silentLogger, type DemoContext } from './helpers.js';

const { webhooks, webhookDeliveries } = schema;

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

let admin: DatabaseHandle;
let app: DatabaseHandle;
let demo: DemoContext;

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  demo = await demoContext(admin);
});

afterAll(async () => {
  await Promise.all([admin.close(), app.close()]);
});

async function createWebhook(secret: string, events: string[] = ['item.updated']) {
  const [row] = await admin.db
    .insert(webhooks)
    .values({
      tenantId: demo.tenantId,
      workspaceId: demo.workspaceId,
      boardId: demo.boardId,
      name: `Webhook ${newId()}`,
      url: 'https://example.com/hooks/cube-track',
      secretCiphertext: encryptSecret(secret, ENCRYPTION_KEY),
      events,
    })
    .returning();
  if (row === undefined) throw new Error('falha ao criar webhook');
  return row;
}

describe('Fan-out de webhooks (fila webhooks → webhook-deliveries)', () => {
  it('despacha uma entrega para cada webhook habilitado cujos eventos incluem o tipo', async () => {
    const webhook = await createWebhook('segredo-1');
    const add = vi.fn().mockResolvedValue(undefined);
    const deliveryQueue = { add } as unknown as Queue;
    const dispatch = webhookFanoutProcessor({ database: app, deliveryQueue, logger: silentLogger });

    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      payload: { itemId: newId(), version: 2, changes: [] },
    });
    const result = await dispatch(fakeJob(event));

    expect(result.dispatched).toBe(1);
    expect(add).toHaveBeenCalledWith(
      'item.updated',
      { webhookId: webhook.id, event },
      { jobId: `${event.eventId}.${webhook.id}` },
    );
  });

  it('não despacha para um evento fora da lista de assinatura do webhook', async () => {
    await createWebhook('segredo-2', ['approval.changed']);
    const add = vi.fn().mockResolvedValue(undefined);
    const deliveryQueue = { add } as unknown as Queue;
    const dispatch = webhookFanoutProcessor({ database: app, deliveryQueue, logger: silentLogger });

    const result = await dispatch(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'item.updated',
          boardId: demo.boardId,
          payload: { itemId: newId(), version: 1, changes: [] },
        }),
      ),
    );
    expect(result.dispatched).toBe(0);
  });
});

describe('Entrega de webhook (assinatura HMAC, retentativa, desabilitação)', () => {
  it('assina o corpo com HMAC-SHA256 do segredo decifrado e grava a entrega como sucedida', async () => {
    const secret = 'segredo-3';
    const webhook = await createWebhook(secret);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const deliver = webhookDeliveryProcessor({
      database: app,
      encryptionKey: ENCRYPTION_KEY,
      logger: silentLogger,
      fetchImpl,
    });

    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      payload: { itemId: newId(), version: 1, changes: [] },
    });
    const job = fakeJob({ webhookId: webhook.id, event });
    const result = await deliver(job);

    expect(result.status).toBe('succeeded');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(webhook.url);
    const body = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-cubetrack-signature']).toBe(
      createHmac('sha256', secret).update(body).digest('hex'),
    );

    const [delivery] = await admin.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.webhookId, webhook.id), eq(webhookDeliveries.eventId, event.eventId)),
      );
    expect(delivery).toMatchObject({ status: 'succeeded', responseStatus: 200 });
  });

  it('na última tentativa sem sucesso, marca a entrega como `dead` e soma falhas consecutivas', async () => {
    const webhook = await createWebhook('segredo-4');
    const fetchImpl = vi.fn().mockResolvedValue(new Response('erro', { status: 500 }));
    const deliver = webhookDeliveryProcessor({
      database: app,
      encryptionKey: ENCRYPTION_KEY,
      logger: silentLogger,
      fetchImpl,
    });

    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      payload: { itemId: newId(), version: 1, changes: [] },
    });
    const job = fakeJob(
      { webhookId: webhook.id, event },
      'test-job',
      { attemptsMade: 4, opts: { attempts: 5 } },
    );

    const result = await deliver(job);
    expect(result.status).toBe('failed');

    const [delivery] = await admin.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.webhookId, webhook.id), eq(webhookDeliveries.eventId, event.eventId)),
      );
    expect(delivery).toMatchObject({ status: 'dead', attempt: 5 });

    const [updated] = await admin.db.select().from(webhooks).where(eq(webhooks.id, webhook.id));
    expect(updated?.consecutiveFailures).toBe(1);
  });

  it('não relança nem repete a entrega quando chamado de novo para a tentativa não-final (deixa o BullMQ retentar)', async () => {
    const webhook = await createWebhook('segredo-5');
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const deliver = webhookDeliveryProcessor({
      database: app,
      encryptionKey: ENCRYPTION_KEY,
      logger: silentLogger,
      fetchImpl,
    });

    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      payload: { itemId: newId(), version: 1, changes: [] },
    });
    const job = fakeJob(
      { webhookId: webhook.id, event },
      'test-job',
      { attemptsMade: 0, opts: { attempts: 5 } },
    );

    await expect(deliver(job)).rejects.toThrow('ECONNREFUSED');

    const [delivery] = await admin.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.webhookId, webhook.id), eq(webhookDeliveries.eventId, event.eventId)),
      );
    expect(delivery).toMatchObject({ status: 'failed', attempt: 1 });
  });
});
