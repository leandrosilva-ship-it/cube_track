import { schema, type DatabaseHandle } from '@cube-track/db';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createNotificationDigest } from '../src/processors/notification-digest.js';
import {
  adminDb,
  appDb,
  demoContext,
  redisClient,
  silentLogger,
  type DemoContext,
} from './helpers.js';

const { notifications, notificationPreferences } = schema;

let admin: DatabaseHandle;
let app: DatabaseHandle;
let redis: Redis;
let demo: DemoContext;

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  redis = redisClient();
  demo = await demoContext(admin);
});

afterAll(async () => {
  redis.disconnect();
  await Promise.all([admin.close(), app.close()]);
});

function fakeEmailsQueue() {
  const add = vi.fn().mockResolvedValue(undefined);
  return { add, queue: { add } as unknown as Queue };
}

describe('Digest de notificações por e-mail (ADR 0051)', () => {
  it('usuário com preferência `hourly` recebe o digest; rodar `daily` em seguida não encontra nada (já enviado)', async () => {
    const userId = demo.users['rafael.mendes'] ?? '';
    await admin.db.insert(notificationPreferences).values({
      tenantId: demo.tenantId,
      userId,
      channel: 'email',
      eventType: '*',
      enabled: true,
      frequency: 'hourly',
    });
    const [notification] = await admin.db
      .insert(notifications)
      .values({
        tenantId: demo.tenantId,
        userId,
        type: 'mention',
        title: 'Você foi mencionado em "Pedido 123"',
      })
      .returning();
    if (notification === undefined) throw new Error('falha ao criar notificação');

    const { add, queue } = fakeEmailsQueue();
    const checkDigest = createNotificationDigest({
      database: app,
      redis,
      emails: queue,
      appUrl: 'http://app.test',
      logger: silentLogger,
    });

    const hourly = await checkDigest('hourly');
    expect(hourly.outcomes).toContainEqual({ tenantId: demo.tenantId, userId, count: 1 });
    expect(add).toHaveBeenCalledTimes(1);
    const [name, data, options] = add.mock.calls[0] as [
      string,
      { template: string },
      { jobId: string },
    ];
    expect(name).toBe('notification_digest');
    expect(data.template).toBe('notification_digest');
    expect(options.jobId.startsWith(`digest:hourly:${userId}:`)).toBe(true);

    const [updated] = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notification.id));
    expect(updated?.emailSentAt).not.toBeNull();

    add.mockClear();
    const daily = await checkDigest('daily');
    expect(daily.outcomes.find((outcome) => outcome.userId === userId)).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('usuário sem preferência customizada (padrão instantâneo) nunca é varrido pelo digest', async () => {
    const userId = demo.users['bruno.oliveira'] ?? '';
    await admin.db.insert(notifications).values({
      tenantId: demo.tenantId,
      userId,
      type: 'automation',
      title: 'Automação executada',
    });

    const { add, queue } = fakeEmailsQueue();
    const checkDigest = createNotificationDigest({
      database: app,
      redis,
      emails: queue,
      appUrl: 'http://app.test',
      logger: silentLogger,
    });

    const hourly = await checkDigest('hourly');
    expect(hourly.outcomes.find((outcome) => outcome.userId === userId)).toBeUndefined();
    const daily = await checkDigest('daily');
    expect(daily.outcomes.find((outcome) => outcome.userId === userId)).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });
});
