import type { AddressInfo } from 'node:net';

import { appendOutboxEvent, schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import {
  QUEUES,
  REALTIME_CHANNEL,
  type DeadLetterJob,
  type RealtimeTransportMessage,
} from '@cube-track/shared';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { createBoardApp, listen } from '../src/board.js';
import { createMailer, emailProcessor, renderEmail } from '../src/processors/email.js';
import { OutboxRelay } from '../src/outbox-relay.js';
import { createQueues, createWorker, type QueueRegistry } from '../src/queues.js';
import {
  adminDb,
  appDb,
  demoContext,
  fakeJob,
  redisClient,
  relayDb,
  silentLogger,
  waitFor,
  type DemoContext,
} from './helpers.js';

let admin: DatabaseHandle;
let app: DatabaseHandle;
let relayDatabase: DatabaseHandle;
let redis: Redis;
let queues: QueueRegistry;
let demo: DemoContext;

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  relayDatabase = relayDb();
  redis = redisClient();
  queues = createQueues(inject('redisUrl'));
  demo = await demoContext(admin);
});

afterAll(async () => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  redis.disconnect();
  await Promise.all([admin.close(), app.close(), relayDatabase.close()]);
});

describe('relay do outbox', () => {
  it('publica no canal realtime, despacha para as filas consumidoras e marca como publicado', async () => {
    const message = await withTenant(app.db, { tenantId: demo.tenantId, userId: null }, (tx) =>
      appendOutboxEvent(tx, {
        tenantId: demo.tenantId,
        type: 'board.updated',
        aggregateType: 'board',
        aggregateId: demo.boardId,
        boardId: demo.boardId,
        payload: { boardId: demo.boardId, changes: { name: 'PMSP' } },
      }),
    );
    const subscriber = redisClient();
    const received: RealtimeTransportMessage[] = [];
    subscriber.on('message', (_channel: string, raw: string) =>
      received.push(JSON.parse(raw) as RealtimeTransportMessage),
    );
    await subscriber.subscribe(REALTIME_CHANNEL);

    const relay = new OutboxRelay(relayDatabase, redis, queues, silentLogger, {
      pollMs: 50,
      batchSize: 500,
      retentionDays: 7,
    });
    let processed = 0;
    for (let round = 0; round < 20; round += 1) {
      const count = await relay.runOnce();
      processed += count;
      if (count === 0) break;
    }
    expect(processed).toBeGreaterThanOrEqual(1);

    const eventId = message.event.eventId;
    await waitFor(() =>
      received.some((entry) => entry.event.eventId === eventId) ? true : undefined,
    );
    const job = await queues[QUEUES.searchIndex].getJob(`${eventId}.${QUEUES.searchIndex}`);
    expect(job?.data).toMatchObject({
      eventId,
      type: 'board.updated',
      boardId: demo.boardId,
      depth: 0,
    });
    const [row] = await admin.db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.id, eventId));
    expect(row?.publishedAt).not.toBeNull();
    expect(await relay.runOnce()).toBe(0);
    await subscriber.quit();
  });

  it('o papel do relay não enxerga tabelas de negócio', async () => {
    const rows = await relayDatabase.db
      .select({ id: schema.items.id })
      .from(schema.items)
      .limit(1)
      .catch(() => []);
    expect(rows).toHaveLength(0);
  });
});

describe('filas', () => {
  it('após esgotar as tentativas, o job vai para a dead-letter queue', async () => {
    const queue = queues[QUEUES.emails];
    await queue.obliterate({ force: true });
    const worker = createWorker(
      QUEUES.emails,
      () => {
        throw new Error('SMTP indisponível');
      },
      {
        redisUrl: inject('redisUrl'),
        concurrency: 1,
        deadLetter: queues[QUEUES.deadLetter],
        logger: silentLogger,
      },
    );
    const job = await queue.add(
      'magic_link',
      { to: 'x@y.com', template: 'magic_link', locale: 'pt-BR', data: {} },
      { attempts: 2, backoff: { type: 'fixed', delay: 10 } },
    );
    const dead = await waitFor(async () => {
      const jobs = await queues[QUEUES.deadLetter].getJobs([
        'waiting',
        'delayed',
        'completed',
        'active',
      ]);
      return jobs.find((entry) => (entry.data as DeadLetterJob).jobId === job.id);
    });
    expect(dead.data).toMatchObject({
      queue: QUEUES.emails,
      failedReason: 'SMTP indisponível',
      attemptsMade: 2,
    });
    await worker.close();
  });

  it('renderiza e envia e-mails com escape de HTML', async () => {
    const rendered = renderEmail('invitation', {
      inviter: 'Ana <script>',
      organization: 'Empresa Demo',
      link: 'https://app.test/i/abc',
      message: 'Bem-vinda!',
    });
    expect(rendered.subject).toBe('Ana <script> convidou você para Empresa Demo no CUBE TRACK');
    expect(rendered.html).toContain('Ana &lt;script&gt;');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.text).toContain('Aceitar convite: https://app.test/i/abc');
    for (const template of [
      'magic_link',
      'password_reset',
      'email_verification',
      'mention',
    ] as const) {
      expect(renderEmail(template, { link: 'https://app.test/x' }).subject.length).toBeGreaterThan(
        5,
      );
    }
    const process = emailProcessor(createMailer('json://'), 'CUBE TRACK <noreply@cubetrack.test>');
    const result = await process(
      fakeJob({
        to: 'carlos@empresademo.com.br',
        template: 'mention',
        locale: 'pt-BR',
        data: { actor: 'Ana', item: 'Portal', excerpt: 'oi', link: 'https://app.test/items/1' },
      }),
    );
    expect(result.messageId).toMatch(/@/);
  });
});

describe('painel de filas (Bull Board)', () => {
  it('exige autenticação básica e expõe health checks', async () => {
    let ready = true;
    const server = await listen(
      createBoardApp({
        queues,
        credentials: { user: 'ops', password: 's3nh@-forte' },
        ready: () => Promise.resolve(ready),
      }),
      0,
    );
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const basic = (user: string, password: string) =>
      `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    try {
      const anonymous = await fetch(`${base}/admin/queues`);
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get('www-authenticate')).toContain('Basic');
      expect(
        (
          await fetch(`${base}/admin/queues`, {
            headers: { authorization: basic('ops', 'errada') },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${base}/admin/queues`, {
            headers: { authorization: basic('ops', 's3nh@-forte') },
          })
        ).status,
      ).toBe(200);
      const api = await fetch(`${base}/admin/queues/api/queues`, {
        headers: { authorization: basic('ops', 's3nh@-forte') },
      });
      expect(api.status).toBe(200);
      expect(JSON.stringify(await api.json())).toContain(QUEUES.deadLetter);
      expect((await fetch(`${base}/health/live`)).status).toBe(200);
      expect((await fetch(`${base}/health/ready`)).status).toBe(200);
      ready = false;
      expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
  });

  it('sem credenciais o painel não é montado', async () => {
    const server = await listen(
      createBoardApp({ queues, credentials: null, ready: () => Promise.resolve(true) }),
      0,
    );
    try {
      expect(
        (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/queues`))
          .status,
      ).toBe(404);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
  });
});
