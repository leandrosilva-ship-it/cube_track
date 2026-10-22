import { once } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { QUEUES, SEARCH_INDEXES, newId, positionBetween } from '@cube-track/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { MeiliSearch } from 'meilisearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { localDate } from '../src/automation/rules.js';
import { automationsProcessor } from '../src/processors/automations.js';
import { fileScanProcessor } from '../src/processors/file-scan.js';
import { notificationsProcessor } from '../src/processors/notifications.js';
import { scheduleProcessor, toScheduleJob } from '../src/processors/schedule.js';
import { ensureSearchIndexes, searchIndexProcessor } from '../src/processors/search-index.js';
import { createQueues, type QueueRegistry } from '../src/queues.js';
import { ClamdScanner } from '../src/scanner.js';
import {
  adminDb,
  appDb,
  demoContext,
  domainEvent,
  fakeJob,
  redisClient,
  silentLogger,
  type DemoContext,
} from './helpers.js';

const {
  items,
  automations,
  automationRuns,
  auditLogs,
  outboxEvents,
  notifications,
  dependencies,
  holidays,
  updates,
  replies,
  mentions,
  approvalRequests,
  approvalApprovers,
} = schema;

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const MAIL_REPLY_DOMAIN = 'reply.test.local';

let admin: DatabaseHandle;
let app: DatabaseHandle;
let redis: Redis;
let queues: QueueRegistry;
let demo: DemoContext;

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  redis = redisClient();
  queues = createQueues(inject('redisUrl'));
  demo = await demoContext(admin);
});

afterAll(async () => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  redis.disconnect();
  await Promise.all([admin.close(), app.close()]);
});

async function createItem(
  name: string,
  groupName: string,
  fields: Partial<typeof items.$inferInsert> = {},
) {
  const groupId = demo.groups[groupName] ?? '';
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
      name,
      position: positionBetween(last?.position ?? null, null),
      ...fields,
    })
    .returning();
  if (item === undefined) throw new Error('falha ao criar item');
  return item;
}

describe('automações', () => {
  const now = new Date();
  const process = () =>
    automationsProcessor({ database: app, redis, logger: silentLogger, now: () => now });

  it('status → Concluído move o item e preenche o término real, com auditoria, outbox e execução registrada', async () => {
    const done = demo.statusLabels['Concluído'] ?? '';
    const item = await createItem('Automação — conclusão', 'Demandas em Andamento', {
      values: { c_status: { labelId: done } },
    });
    const eventId = newId();
    const event = domainEvent({
      eventId,
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      itemId: item.id,
      actorId: demo.users['ana.ribeiro'] ?? null,
      payload: {
        itemId: item.id,
        version: 2,
        changes: [{ field: 'c_status', kind: 'column', value: { labelId: done }, version: 1 }],
      },
    });

    const result = await process()(fakeJob(event));
    expect(result.outcomes).toContainEqual(expect.objectContaining({ status: 'succeeded' }));

    const [updated] = await admin.db.select().from(items).where(eq(items.id, item.id));
    expect(updated?.groupId).toBe(demo.groups['Concluídas']);
    expect(updated?.actualEndDate).toBe(localDate(now, 'America/Sao_Paulo'));
    expect(updated?.version).toBe(item.version + 1);
    expect(updated?.fieldVersions).toMatchObject({ group_id: 1, actualEndDate: 1 });

    const runs = await admin.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.triggerEventId, eventId));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'succeeded', depth: 1, itemId: item.id });

    const [emitted] = await admin.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.causationId, eventId));
    expect(emitted).toMatchObject({
      eventType: 'item.updated',
      actorKind: 'automation',
      depth: 1,
      itemId: item.id,
    });

    const audits = await admin.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, item.id), eq(auditLogs.actorKind, 'automation')));
    expect(audits.map((entry) => entry.action)).toContain('item.updated');

    // Reentrega do mesmo evento (retry/relay): não executa de novo.
    const again = await process()(fakeJob(event));
    expect(again.outcomes.find((outcome) => outcome.status === 'succeeded')).toBeUndefined();
    expect(
      await admin.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.triggerEventId, eventId)),
    ).toHaveLength(1);
  });

  it('não dispara quando o novo valor não é o alvo do gatilho', async () => {
    const other =
      Object.entries(demo.statusLabels).find(([label]) => label !== 'Concluído')?.[1] ?? '';
    const item = await createItem('Automação — sem disparo', 'Demandas em Andamento', {
      values: { c_status: { labelId: other } },
    });
    const result = await process()(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'item.updated',
          boardId: demo.boardId,
          itemId: item.id,
          payload: {
            changes: [{ field: 'c_status', kind: 'column', value: { labelId: other }, version: 1 }],
          },
        }),
      ),
    );
    expect(result.outcomes.every((outcome) => outcome.status === 'not_matched')).toBe(true);
    const [after] = await admin.db.select().from(items).where(eq(items.id, item.id));
    expect(after?.groupId).toBe(item.groupId);
  });

  it('interrompe cadeias na profundidade máxima (proteção contra loops)', async () => {
    const item = await createItem('Automação — loop', 'Demandas em Andamento');
    const result = await process()(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'item.updated',
          boardId: demo.boardId,
          itemId: item.id,
          depth: 3,
          actorKind: 'automation',
        }),
      ),
    );
    expect(result).toEqual({ outcomes: [], skipped: 'depth' });
  });

  it('configuração inválida registra falha sem reprocessar e notifica responsáveis em ações válidas', async () => {
    const carlos = demo.users['carlos.lima'] ?? '';
    const [broken] = await admin.db
      .insert(automations)
      .values({
        tenantId: demo.tenantId,
        workspaceId: demo.workspaceId,
        boardId: demo.boardId,
        name: 'Quebrada',
        trigger: { type: 'item_created', config: {} },
        actions: [{ type: 'move_to_group', config: { groupId: newId() } }],
      })
      .returning();
    const [notify] = await admin.db
      .insert(automations)
      .values({
        tenantId: demo.tenantId,
        workspaceId: demo.workspaceId,
        boardId: null,
        name: 'Avisar responsáveis',
        trigger: { type: 'item_created', config: {} },
        actions: [
          {
            type: 'notify',
            config: { peopleColumnKey: 'c_responsaveis', message: 'Novo item: {item.name}' },
          },
        ],
      })
      .returning();
    const item = await createItem('Automação — criação', 'Demandas em Análise', {
      values: { c_responsaveis: { personIds: [carlos], teamIds: [] } },
    });
    const result = await process()(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'item.created',
          boardId: demo.boardId,
          itemId: item.id,
          payload: {},
        }),
      ),
    );
    expect(result.outcomes).toContainEqual({ automationId: broken?.id, status: 'failed' });
    expect(result.outcomes).toContainEqual({ automationId: notify?.id, status: 'succeeded' });

    const [brokenAfter] = await admin.db
      .select()
      .from(automations)
      .where(eq(automations.id, broken?.id ?? ''));
    expect(brokenAfter?.errorCount).toBe(1);
    const [failedRun] = await admin.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, broken?.id ?? ''));
    expect(failedRun?.status).toBe('failed');
    expect(failedRun?.error).toContain('Grupo de destino');

    const [notification] = await admin.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, carlos), eq(notifications.itemId, item.id)));
    expect(notification?.title).toBe('Novo item: Automação — criação');
    await admin.db
      .update(automations)
      .set({ isEnabled: false })
      .where(inArray(automations.id, [broken?.id ?? '', notify?.id ?? '']));
  });
});

describe('recálculo de cronograma', () => {
  it('empurra sucessores (FS) respeitando fins de semana e feriados da empresa, com auditoria e evento', async () => {
    const predecessor = await createItem('Cronograma — A', 'Demandas em Análise', {
      plannedStartDate: '2026-11-09',
      plannedEndDate: '2026-11-13',
    });
    const successor = await createItem('Cronograma — B', 'Demandas em Análise', {
      plannedStartDate: '2026-11-10',
      plannedEndDate: '2026-11-11',
    });
    const untouched = await createItem('Cronograma — C', 'Demandas em Análise', {
      plannedStartDate: '2026-11-03',
      plannedEndDate: '2026-11-04',
    });
    await admin.db.insert(dependencies).values([
      {
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        predecessorId: predecessor.id,
        successorId: successor.id,
        type: 'FS',
        lagDays: 0,
      },
    ]);
    await admin.db.insert(holidays).values({
      tenantId: demo.tenantId,
      date: '2026-11-16',
      name: 'Ponte da empresa',
      scope: 'company',
    });

    const eventId = newId();
    const event = domainEvent({
      eventId,
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      itemId: predecessor.id,
      payload: {
        itemId: predecessor.id,
        version: 2,
        changes: [{ field: 'plannedEndDate', kind: 'native', value: '2026-11-13', version: 1 }],
      },
    });
    expect(toScheduleJob(event)).toMatchObject({ itemId: predecessor.id, causationId: eventId });
    expect(
      toScheduleJob({ ...event, payload: { changes: [{ field: 'name', value: 'x' }] } }),
    ).toBeNull();

    const result = await scheduleProcessor({ database: app, redis })(fakeJob(event));
    expect(result.rescheduled).toBe(1);

    const [moved] = await admin.db.select().from(items).where(eq(items.id, successor.id));
    // Fim de A: sex 13/11 → próximo dia útil seg 16/11 é ponte → B começa ter 17/11 e mantém 2 dias úteis.
    expect(moved).toMatchObject({
      plannedStartDate: '2026-11-17',
      plannedEndDate: '2026-11-18',
      version: successor.version + 1,
    });
    const [same] = await admin.db.select().from(items).where(eq(items.id, untouched.id));
    expect(same?.version).toBe(untouched.version);

    const [audit] = await admin.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, successor.id), eq(auditLogs.action, 'item.rescheduled')));
    expect(audit?.after).toEqual({ plannedStartDate: '2026-11-17', plannedEndDate: '2026-11-18' });
    const [emitted] = await admin.db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.causationId, eventId), eq(outboxEvents.itemId, successor.id)));
    expect(emitted).toMatchObject({ eventType: 'item.updated', actorKind: 'system' });

    // Idempotente: novo recálculo não altera nada.
    expect((await scheduleProcessor({ database: app, redis })(fakeJob(event))).rescheduled).toBe(0);
  });

  it('adicionar um predecessor (sem mexer em datas) também dispara o recálculo', async () => {
    const predecessor = await createItem('Cronograma — dep A', 'Demandas em Análise', {
      plannedStartDate: '2026-11-09',
      plannedEndDate: '2026-11-13',
    });
    const successor = await createItem('Cronograma — dep B', 'Demandas em Análise', {
      plannedStartDate: '2026-11-10',
      plannedEndDate: '2026-11-11',
    });
    await admin.db.insert(dependencies).values([
      {
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        predecessorId: predecessor.id,
        successorId: successor.id,
        type: 'FS',
        lagDays: 0,
      },
    ]);
    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      itemId: successor.id,
      payload: {
        itemId: successor.id,
        version: 2,
        changes: [{ field: 'dependencies', kind: 'native', value: [predecessor.id], version: 1 }],
      },
    });
    expect(toScheduleJob(event)).toMatchObject({ itemId: successor.id });
    const result = await scheduleProcessor({ database: app, redis })(fakeJob(event));
    expect(result.rescheduled).toBe(1);
    const [moved] = await admin.db.select().from(items).where(eq(items.id, successor.id));
    // FS: o sucessor passa a começar depois do fim do predecessor (antes começava um dia antes dele).
    expect((moved?.plannedStartDate ?? '') > (predecessor.plannedEndDate ?? '')).toBe(true);
    expect(moved?.version).toBe(successor.version + 1);
  });

  it('item em modo manual nunca é empurrado pelo recálculo', async () => {
    const predecessor = await createItem('Cronograma — manual A', 'Demandas em Análise', {
      plannedStartDate: '2026-11-09',
      plannedEndDate: '2026-11-13',
    });
    const manualSuccessor = await createItem('Cronograma — manual B', 'Demandas em Análise', {
      plannedStartDate: '2026-11-10',
      plannedEndDate: '2026-11-11',
      scheduleMode: 'manual',
    });
    await admin.db.insert(dependencies).values([
      {
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        predecessorId: predecessor.id,
        successorId: manualSuccessor.id,
        type: 'FS',
        lagDays: 0,
      },
    ]);
    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      itemId: predecessor.id,
      payload: {
        itemId: predecessor.id,
        version: 2,
        changes: [{ field: 'plannedEndDate', kind: 'native', value: '2026-11-13', version: 1 }],
      },
    });
    const result = await scheduleProcessor({ database: app, redis })(fakeJob(event));
    expect(result.rescheduled).toBe(0);
    const [unchanged] = await admin.db
      .select()
      .from(items)
      .where(eq(items.id, manualSuccessor.id));
    expect(unchanged).toMatchObject({
      plannedStartDate: '2026-11-10',
      plannedEndDate: '2026-11-11',
      version: manualSuccessor.version,
    });
  });
});

describe('notificações de menção', () => {
  it('notifica mencionados (exceto o autor), emite evento do usuário e enfileira e-mail', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const item = await createItem('Notificação — menção', 'Demandas em Análise');
    const [update] = await admin.db
      .insert(updates)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemId: item.id,
        authorId: ana,
        body: { type: 'doc' },
        bodyText: '@Carlos pode revisar?',
      })
      .returning();
    await admin.db.insert(mentions).values([
      {
        tenantId: demo.tenantId,
        sourceType: 'update',
        sourceId: update?.id ?? '',
        itemId: item.id,
        targetType: 'user',
        targetId: carlos,
      },
      {
        tenantId: demo.tenantId,
        sourceType: 'update',
        sourceId: update?.id ?? '',
        itemId: item.id,
        targetType: 'user',
        targetId: ana,
      },
    ]);
    await queues[QUEUES.emails].obliterate({ force: true });
    const process = notificationsProcessor({
      database: app,
      redis,
      emails: queues[QUEUES.emails],
      appUrl: 'http://app.test',
      jwtSecret: JWT_SECRET,
      mailReplyDomain: MAIL_REPLY_DOMAIN,
    });
    const result = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'update.created',
          boardId: demo.boardId,
          itemId: item.id,
          actorId: ana,
          payload: {
            updateId: update?.id,
            itemId: item.id,
            authorId: ana,
            bodyText: '@Carlos pode revisar?',
          },
        }),
      ),
    );
    expect(result.notified).toBe(1);
    const rows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, update?.id ?? ''));
    expect(rows.map((row) => row.userId)).toEqual([carlos]);
    const [event] = await admin.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'notification.created'),
          eq(outboxEvents.userId, carlos),
          eq(outboxEvents.aggregateId, rows[0]?.id ?? ''),
        ),
      );
    expect(event).toBeDefined();
    const jobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(jobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({
        to: 'carlos.lima@empresademo.com.br',
        template: 'mention',
        replyTo: expect.stringMatching(/^reply\+.+@reply\.test\.local$/) as unknown,
      }),
    );
  });

  it('notifica menção numa resposta (reply.created)', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const item = await createItem('Notificação — menção em resposta', 'Demandas em Análise');
    const [update] = await admin.db
      .insert(updates)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemId: item.id,
        authorId: ana,
        body: { type: 'doc' },
        bodyText: 'Atualização original',
      })
      .returning();
    const [reply] = await admin.db
      .insert(replies)
      .values({
        tenantId: demo.tenantId,
        updateId: update?.id ?? '',
        authorId: ana,
        body: { type: 'doc' },
        bodyText: '@Carlos, pode confirmar?',
      })
      .returning();
    await admin.db.insert(mentions).values([
      {
        tenantId: demo.tenantId,
        sourceType: 'reply',
        sourceId: reply?.id ?? '',
        itemId: item.id,
        targetType: 'user',
        targetId: carlos,
      },
    ]);
    await queues[QUEUES.emails].obliterate({ force: true });
    const process = notificationsProcessor({
      database: app,
      redis,
      emails: queues[QUEUES.emails],
      appUrl: 'http://app.test',
      jwtSecret: JWT_SECRET,
      mailReplyDomain: MAIL_REPLY_DOMAIN,
    });
    const result = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'reply.created',
          boardId: demo.boardId,
          itemId: item.id,
          actorId: ana,
          payload: {
            replyId: reply?.id,
            updateId: update?.id,
            itemId: item.id,
            authorId: ana,
            bodyText: '@Carlos, pode confirmar?',
          },
        }),
      ),
    );
    expect(result.notified).toBe(1);
    const rows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, reply?.id ?? ''));
    expect(rows.map((row) => row.userId)).toEqual([carlos]);
  });
});

describe('notificações de aprovação', () => {
  it('notifica os aprovadores quando um pedido é criado', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const item = await createItem('Aprovação — pedido criado', 'Demandas em Análise');
    const [request] = await admin.db
      .insert(approvalRequests)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemId: item.id,
        requestedBy: ana,
        mode: 'any',
        status: 'pending',
      })
      .returning();
    await admin.db.insert(approvalApprovers).values({
      tenantId: demo.tenantId,
      requestId: request?.id ?? '',
      userId: carlos,
    });
    await queues[QUEUES.emails].obliterate({ force: true });
    const process = notificationsProcessor({
      database: app,
      redis,
      emails: queues[QUEUES.emails],
      appUrl: 'http://app.test',
      jwtSecret: JWT_SECRET,
      mailReplyDomain: MAIL_REPLY_DOMAIN,
    });
    const result = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'approval.changed',
          boardId: demo.boardId,
          itemId: item.id,
          actorId: ana,
          payload: { requestId: request?.id, itemId: item.id, status: 'pending', requestedBy: ana },
        }),
      ),
    );
    expect(result.notified).toBe(1);
    const rows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, request?.id ?? ''));
    expect(rows.map((row) => row.userId)).toEqual([carlos]);
    const jobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(jobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'carlos.lima@empresademo.com.br', template: 'approval_requested' }),
    );
  });

  it('notifica quem pediu quando o pedido é resolvido', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const item = await createItem('Aprovação — pedido resolvido', 'Demandas em Análise');
    const [request] = await admin.db
      .insert(approvalRequests)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemId: item.id,
        requestedBy: ana,
        mode: 'any',
        status: 'approved',
        resolvedAt: new Date(),
      })
      .returning();
    const process = notificationsProcessor({
      database: app,
      redis,
      emails: queues[QUEUES.emails],
      appUrl: 'http://app.test',
      jwtSecret: JWT_SECRET,
      mailReplyDomain: MAIL_REPLY_DOMAIN,
    });
    const result = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'approval.changed',
          boardId: demo.boardId,
          itemId: item.id,
          actorId: carlos,
          payload: { requestId: request?.id, itemId: item.id, status: 'approved', requestedBy: ana },
        }),
      ),
    );
    expect(result.notified).toBe(1);
    const rows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, request?.id ?? ''));
    expect(rows.map((row) => row.userId)).toEqual([ana]);
  });
});

describe('indexação de busca', () => {
  it('indexa e remove itens no Meilisearch a partir de eventos de domínio', async () => {
    const meili = new MeiliSearch({ host: inject('meiliUrl'), apiKey: inject('meiliKey') });
    await ensureSearchIndexes(meili);
    const item = await createItem(
      'Busca — Portal da Transparência Indexado',
      'Demandas em Análise',
    );
    const process = searchIndexProcessor({ database: app, meili });
    const created = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'item.created',
          boardId: demo.boardId,
          itemId: item.id,
        }),
      ),
    );
    expect(created).toEqual({ indexed: 1, deleted: 0 });
    const document = await meili.index(SEARCH_INDEXES.items).getDocument(item.id);
    expect(document).toMatchObject({
      name: item.name,
      tenantId: demo.tenantId,
      boardId: demo.boardId,
    });

    await admin.db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, item.id));
    const removed = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'item.deleted',
          boardId: demo.boardId,
          itemId: item.id,
        }),
      ),
    );
    expect(removed).toEqual({ indexed: 0, deleted: 1 });
    await expect(meili.index(SEARCH_INDEXES.items).getDocument(item.id)).rejects.toThrow();
  });
});

describe('varredura antivírus', () => {
  const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  let clamd: Server;
  let s3: S3Client;

  beforeAll(async () => {
    // clamd falso: implementa zINSTREAM e detecta a assinatura EICAR.
    clamd = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const header = 'zINSTREAM\0';
        if (buffer.length < header.length) return;
        let offset = header.length;
        const body: Buffer[] = [];
        while (offset + 4 <= buffer.length) {
          const size = buffer.readUInt32BE(offset);
          if (size === 0) {
            const content = Buffer.concat(body).toString('latin1');
            socket.end(
              content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
                ? 'stream: Eicar-Test-Signature FOUND\0'
                : 'stream: OK\0',
            );
            return;
          }
          if (offset + 4 + size > buffer.length) return;
          body.push(buffer.subarray(offset + 4, offset + 4 + size));
          offset += 4 + size;
        }
      });
    });
    clamd.listen(0, '127.0.0.1');
    await once(clamd, 'listening');
    s3 = new S3Client({
      endpoint: inject('s3Endpoint'),
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'S3RVER', secretAccessKey: 'S3RVER' },
    });
  });

  afterAll(async () => {
    s3.destroy();
    await new Promise<void>((resolve) =>
      clamd.close(() => {
        resolve();
      }),
    );
  });

  async function uploaded(content: string) {
    const item = await createItem('Arquivo', 'Demandas em Análise');
    const storageKey = `${demo.tenantId}/${newId()}/arquivo.txt`;
    await s3.send(
      new PutObjectCommand({ Bucket: 'cubetrack-test', Key: storageKey, Body: content }),
    );
    const [attachment] = await admin.db
      .insert(schema.attachments)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemId: item.id,
        fileName: 'arquivo.txt',
      })
      .returning();
    const [version] = await admin.db
      .insert(schema.attachmentVersions)
      .values({
        tenantId: demo.tenantId,
        attachmentId: attachment?.id ?? '',
        version: 1,
        storageKey,
        mimeType: 'text/plain',
        sizeBytes: content.length,
        checksumSha256: 'x'.repeat(64),
      })
      .returning();
    return { attachmentId: attachment?.id ?? '', versionId: version?.id ?? '', storageKey };
  }

  it('aprova arquivo limpo e remove arquivo infectado do storage', async () => {
    const scanner = new ClamdScanner('127.0.0.1', (clamd.address() as AddressInfo).port, 5_000);
    const process = fileScanProcessor({ database: app, s3, bucket: 'cubetrack-test', scanner });

    const clean = await uploaded('conteúdo legítimo');
    expect(await process(fakeJob({ tenantId: demo.tenantId, ...clean }))).toEqual({ clean: true });
    const [cleanRow] = await admin.db
      .select()
      .from(schema.attachmentVersions)
      .where(eq(schema.attachmentVersions.id, clean.versionId));
    expect(cleanRow?.scanStatus).toBe('clean');

    const infected = await uploaded(EICAR);
    expect(await process(fakeJob({ tenantId: demo.tenantId, ...infected }))).toEqual({
      clean: false,
      signature: 'Eicar-Test-Signature',
    });
    const [infectedRow] = await admin.db
      .select()
      .from(schema.attachmentVersions)
      .where(eq(schema.attachmentVersions.id, infected.versionId));
    expect(infectedRow?.scanStatus).toBe('infected');
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: 'cubetrack-test', Key: infected.storageKey })),
    ).rejects.toThrow();
    const [audit] = await admin.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, infected.attachmentId),
          eq(auditLogs.action, 'file.scan_infected'),
        ),
      );
    expect(audit).toBeDefined();
    await s3.send(new DeleteObjectCommand({ Bucket: 'cubetrack-test', Key: clean.storageKey }));
  });
});
