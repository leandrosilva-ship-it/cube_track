import { randomBytes } from 'node:crypto';

import { schema, type DatabaseHandle } from '@cube-track/db';
import { newId, positionBetween } from '@cube-track/shared';
import { encryptSecret } from '@cube-track/shared/crypto';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { calendarSyncPushProcessor, createCalendarSyncPeriodic } from '../src/processors/calendar-sync.js';
import { adminDb, appDb, demoContext, domainEvent, fakeJob, redisClient, silentLogger, type DemoContext } from './helpers.js';

const { items, integrationConnections, calendarSyncLinks } = schema;

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

let admin: DatabaseHandle;
let app: DatabaseHandle;
let demo: DemoContext;
const redis = redisClient();

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  demo = await demoContext(admin);
});

afterAll(async () => {
  redis.disconnect();
  await Promise.all([admin.close(), app.close()]);
});

async function createItem(fields: Partial<typeof items.$inferInsert> = {}) {
  const groupId = Object.values(demo.groups)[0] ?? '';
  const [last] = await admin.db
    .select({ position: items.position })
    .from(items)
    .where(eq(items.groupId, groupId))
    .orderBy(desc(items.position))
    .limit(1);
  const [item] = await admin.db
    .insert(items)
    .values({
      tenantId: demo.tenantId,
      boardId: demo.boardId,
      groupId,
      name: `Item de teste de calendário ${newId()}`,
      position: positionBetween(last?.position ?? null, null),
      ...fields,
    })
    .returning();
  if (item === undefined) throw new Error('falha ao criar item');
  return item;
}

async function createGoogleConnection(userId: string) {
  const [connection] = await admin.db
    .insert(integrationConnections)
    .values({
      tenantId: demo.tenantId,
      workspaceId: demo.workspaceId,
      provider: 'google',
      authKind: 'oauth',
      userId,
      accessTokenCiphertext: encryptSecret('access-token-valido', ENCRYPTION_KEY),
      refreshTokenCiphertext: encryptSecret('refresh-token-valido', ENCRYPTION_KEY),
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      isActive: true,
      createdBy: userId,
    })
    .returning();
  if (connection === undefined) throw new Error('falha ao criar conexão');
  return connection;
}

function responsaveis(personIds: string[]) {
  return { c_responsaveis: { personIds, teamIds: [] } };
}

describe('Sincronização de calendário (Google/Microsoft, ADR 0056)', () => {
  describe('push (item → calendário)', () => {
    it('cria o evento no calendário do responsável e grava calendar_sync_links', async () => {
      const userId = demo.users['ana.ribeiro'] ?? '';
      const connection = await createGoogleConnection(userId);
      const item = await createItem({
        values: responsaveis([userId]),
        plannedStartDate: '2026-04-01',
        plannedEndDate: '2026-04-03',
      });

      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'google-event-1' }), { status: 200 }));
      const processor = calendarSyncPushProcessor({
        database: app,
        redis,
        encryptionKey: ENCRYPTION_KEY,
        appUrl: 'http://app.test',
        logger: silentLogger,
        fetchImpl,
      });
      const event = domainEvent({
        eventId: newId(),
        tenantId: demo.tenantId,
        type: 'item.created',
        boardId: demo.boardId,
        itemId: item.id,
      });
      const result = await processor(fakeJob(event));
      expect(result.synced).toBe(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body as string) as { start: { date: string }; end: { date: string } };
      expect(body.start.date).toBe('2026-04-01');
      expect(body.end.date).toBe('2026-04-04'); // end exclusivo (Google): +1 dia

      const [link] = await admin.db
        .select()
        .from(calendarSyncLinks)
        .where(and(eq(calendarSyncLinks.itemId, item.id), eq(calendarSyncLinks.connectionId, connection.id)));
      expect(link?.externalEventId).toBe('google-event-1');
    });

    it('não sincroniza um item `item.updated` cujas mudanças não tocam datas', async () => {
      const userId = demo.users['carlos.lima'] ?? '';
      await createGoogleConnection(userId);
      const item = await createItem({ values: responsaveis([userId]) });
      const fetchImpl = vi.fn();
      const processor = calendarSyncPushProcessor({
        database: app,
        redis,
        encryptionKey: ENCRYPTION_KEY,
        appUrl: 'http://app.test',
        logger: silentLogger,
        fetchImpl,
      });
      const event = domainEvent({
        eventId: newId(),
        tenantId: demo.tenantId,
        type: 'item.updated',
        boardId: demo.boardId,
        itemId: item.id,
        payload: { itemId: item.id, version: 2, changes: [{ field: 'name', kind: 'native', value: 'x', version: 2 }] },
      });
      const result = await processor(fakeJob(event));
      expect(result.synced).toBe(0);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('exclui o evento e o vínculo quando as datas do item são removidas', async () => {
      const userId = demo.users['fernanda.souza'] ?? '';
      const connection = await createGoogleConnection(userId);
      const item = await createItem({
        values: responsaveis([userId]),
        plannedStartDate: '2026-05-01',
        plannedEndDate: '2026-05-02',
      });
      await admin.db.insert(calendarSyncLinks).values({
        tenantId: demo.tenantId,
        itemId: item.id,
        connectionId: connection.id,
        externalEventId: 'google-event-to-delete',
        externalCalendarId: 'primary',
      });
      await admin.db.update(items).set({ plannedStartDate: null, plannedEndDate: null }).where(eq(items.id, item.id));

      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const processor = calendarSyncPushProcessor({
        database: app,
        redis,
        encryptionKey: ENCRYPTION_KEY,
        appUrl: 'http://app.test',
        logger: silentLogger,
        fetchImpl,
      });
      const event = domainEvent({
        eventId: newId(),
        tenantId: demo.tenantId,
        type: 'item.updated',
        boardId: demo.boardId,
        itemId: item.id,
        payload: {
          itemId: item.id,
          version: 2,
          changes: [{ field: 'plannedStartDate', kind: 'native', value: null, version: 2 }],
        },
      });
      await processor(fakeJob(event));

      expect(fetchImpl).toHaveBeenCalledWith(
        expect.stringContaining('google-event-to-delete'),
        expect.objectContaining({ method: 'DELETE' }),
      );
      const remaining = await admin.db
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.itemId, item.id));
      expect(remaining).toHaveLength(0);
    });
  });

  describe('pull periódico (calendário → item)', () => {
    it('zera as datas do item quando o evento foi excluído no Google Calendar', async () => {
      const userId = demo.users['rafael.mendes'] ?? '';
      const connection = await createGoogleConnection(userId);
      const item = await createItem({
        values: responsaveis([userId]),
        plannedStartDate: '2026-06-01',
        plannedEndDate: '2026-06-05',
      });
      await admin.db.insert(calendarSyncLinks).values({
        tenantId: demo.tenantId,
        itemId: item.id,
        connectionId: connection.id,
        externalEventId: 'google-event-cancelled',
        externalCalendarId: 'primary',
      });

      // `mockImplementation` (não `mockResolvedValue`): o `runPeriodic` chama `fetch` uma vez por
      // conexão ativa (há mais de uma no banco de teste compartilhado) — um `Response` só pode ter o
      // corpo lido uma vez, então precisa de uma instância nova a cada chamada.
      const fetchImpl = vi
        .fn()
        .mockImplementation(
          () =>
            new Response(
              JSON.stringify({ items: [{ id: 'google-event-cancelled', status: 'cancelled' }] }),
              { status: 200 },
            ),
        );
      const runPeriodic = createCalendarSyncPeriodic({
        database: app,
        redis,
        encryptionKey: ENCRYPTION_KEY,
        appUrl: 'http://app.test',
        logger: silentLogger,
        fetchImpl,
      });
      const { outcomes } = await runPeriodic();
      expect(outcomes.find((outcome) => outcome.connectionId === connection.id)?.reconciled).toBe(1);

      const [updated] = await admin.db.select().from(items).where(eq(items.id, item.id));
      expect(updated?.plannedStartDate).toBeNull();
      expect(updated?.plannedEndDate).toBeNull();
      const remainingLinks = await admin.db
        .select()
        .from(calendarSyncLinks)
        .where(eq(calendarSyncLinks.itemId, item.id));
      expect(remainingLinks).toHaveLength(0);
    });

    it('atualiza as datas do item quando o evento foi movido no Google Calendar', async () => {
      const userId = demo.users['juliana.castro'] ?? '';
      const connection = await createGoogleConnection(userId);
      const item = await createItem({
        values: responsaveis([userId]),
        plannedStartDate: '2026-07-01',
        plannedEndDate: '2026-07-02',
      });
      await admin.db.insert(calendarSyncLinks).values({
        tenantId: demo.tenantId,
        itemId: item.id,
        connectionId: connection.id,
        externalEventId: 'google-event-moved',
        externalCalendarId: 'primary',
      });

      const fetchImpl = vi.fn().mockImplementation(
        () =>
          new Response(
            JSON.stringify({
              items: [{ id: 'google-event-moved', start: { date: '2026-07-10' }, end: { date: '2026-07-13' } }],
            }),
            { status: 200 },
          ),
      );
      const runPeriodic = createCalendarSyncPeriodic({
        database: app,
        redis,
        encryptionKey: ENCRYPTION_KEY,
        appUrl: 'http://app.test',
        logger: silentLogger,
        fetchImpl,
      });
      await runPeriodic();

      const [updated] = await admin.db.select().from(items).where(eq(items.id, item.id));
      expect(updated?.plannedStartDate).toBe('2026-07-10');
      // Google: end.date exclusivo — o evento termina em 13, então o item termina em 12.
      expect(updated?.plannedEndDate).toBe('2026-07-12');
    });
  });
});
