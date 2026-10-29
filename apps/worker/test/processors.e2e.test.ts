import { once } from 'node:events';
import { createServer, type AddressInfo, type Server } from 'node:net';

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { QUEUES, SEARCH_INDEXES, localDate, newId, positionBetween } from '@cube-track/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { MeiliSearch } from 'meilisearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { automationsProcessor } from '../src/processors/automations.js';
import { fileScanProcessor } from '../src/processors/file-scan.js';
import { notificationsProcessor } from '../src/processors/notifications.js';
import { portfolioProcessor } from '../src/processors/portfolio.js';
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
  notificationPreferences,
  dependencies,
  holidays,
  updates,
  replies,
  mentions,
  approvalRequests,
  approvalApprovers,
  absences,
  resourceRequests,
  timesheetApprovals,
  risks,
  issues,
  budgets,
  costEntries,
  projectHealth,
  healthRuleSets,
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
    automationsProcessor({ database: app, redis, logger: silentLogger, now: () => now })
      .processEvent;

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

  it('date_arrives: a varredura diária dispara 2 dias antes do término planejado, uma vez por dia', async () => {
    const twoDaysFromNow = new Date();
    twoDaysFromNow.setUTCDate(twoDaysFromNow.getUTCDate() + 2);
    const plannedEndDate = twoDaysFromNow.toISOString().slice(0, 10);
    const item = await createItem('Automação — prazo chegando', 'Demandas em Andamento', {
      plannedEndDate,
    });
    const [rule] = await admin.db
      .insert(automations)
      .values({
        tenantId: demo.tenantId,
        workspaceId: demo.workspaceId,
        boardId: demo.boardId,
        name: 'Avisar 2 dias antes do prazo',
        trigger: { type: 'date_arrives', config: { columnKey: 'plannedEndDate', offsetDays: -2 } },
        actions: [{ type: 'notify', config: { message: 'Prazo em 2 dias: {item.name}' } }],
      })
      .returning();

    const dateCheck = () =>
      automationsProcessor({ database: app, redis, logger: silentLogger }).checkDateArrives();

    const first = await dateCheck();
    expect(first.outcomes).toContainEqual({ automationId: rule?.id, status: 'succeeded' });
    const runsAfterFirst = await admin.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, rule?.id ?? ''));
    expect(runsAfterFirst).toHaveLength(1);
    expect(runsAfterFirst[0]).toMatchObject({ itemId: item.id, status: 'succeeded' });

    // Rodar de novo no mesmo dia não duplica (dedupe pelo triggerEventId sintético do dia).
    const second = await dateCheck();
    expect(second.outcomes.find((outcome) => outcome.automationId === rule?.id)?.status).toBe(
      'duplicate',
    );
    expect(
      await admin.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.automationId, rule?.id ?? '')),
    ).toHaveLength(1);

    await admin.db
      .update(automations)
      .set({ isEnabled: false })
      .where(eq(automations.id, rule?.id ?? ''));
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
    const [unchanged] = await admin.db.select().from(items).where(eq(items.id, manualSuccessor.id));
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
      expect.objectContaining({
        to: 'carlos.lima@empresademo.com.br',
        template: 'approval_requested',
      }),
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
          payload: {
            requestId: request?.id,
            itemId: item.id,
            status: 'approved',
            requestedBy: ana,
          },
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

  it('não envia e-mail instantâneo quando a preferência do aprovador é `daily` (ADR 0051)', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const fernanda = demo.users['fernanda.souza'] ?? '';
    await admin.db.insert(notificationPreferences).values({
      tenantId: demo.tenantId,
      userId: fernanda,
      channel: 'email',
      eventType: 'approval',
      enabled: true,
      frequency: 'daily',
    });
    const item = await createItem('Aprovação — preferência diária', 'Demandas em Análise');
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
      userId: fernanda,
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
    expect(rows).toHaveLength(1);
    expect(rows[0]?.emailSentAt).toBeNull();
    const jobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(jobs.map((job) => job.data as unknown)).not.toContainEqual(
      expect.objectContaining({ to: 'fernanda.souza@empresademo.com.br' }),
    );
  });
});

describe('notificações de capacidade e timesheet (ADR 0052)', () => {
  it('ausência solicitada notifica o gestor direto; decidida notifica quem pediu', async () => {
    const rafael = demo.users['rafael.mendes'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const [absence] = await admin.db
      .insert(absences)
      .values({
        tenantId: demo.tenantId,
        userId: rafael,
        type: 'vacation',
        startDate: '2027-11-01',
        endDate: '2027-11-05',
        status: 'submitted',
        createdBy: rafael,
      })
      .returning();
    // O padrão do seed é digest diário por e-mail (`eventType: '*'`); para testar o envio instantâneo é
    // preciso a preferência específica do tipo, mesma regra das outras notificações (ADR 0048/0051).
    await admin.db.insert(notificationPreferences).values([
      { tenantId: demo.tenantId, userId: carlos, channel: 'email', eventType: 'absence', frequency: 'instant', createdBy: carlos },
      { tenantId: demo.tenantId, userId: rafael, channel: 'email', eventType: 'absence', frequency: 'instant', createdBy: rafael },
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
    const created = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'absence.changed',
          actorId: rafael,
          payload: { absenceId: absence?.id, userId: rafael, change: 'created' },
        }),
      ),
    );
    expect(created.notified).toBe(1);
    const createdRows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, absence?.id ?? ''));
    expect(createdRows.map((row) => row.userId)).toEqual([carlos]);
    const createdJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(createdJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'carlos.lima@empresademo.com.br', template: 'absence_requested' }),
    );

    await queues[QUEUES.emails].obliterate({ force: true });
    const decided = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'absence.changed',
          actorId: carlos,
          payload: { absenceId: absence?.id, userId: rafael, change: 'approved' },
        }),
      ),
    );
    expect(decided.notified).toBe(1);
    const decidedRows = await admin.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.entityId, absence?.id ?? ''), eq(notifications.userId, rafael)));
    expect(decidedRows).toHaveLength(1);
    const decidedJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(decidedJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'rafael.mendes@empresademo.com.br', template: 'absence_decided' }),
    );
  });

  it('solicitação de recurso criada notifica quem tem `resources.manage`; atendida notifica o dono do board (sem e-mail no cancelamento)', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const fernanda = demo.users['fernanda.souza'] ?? '';
    const [request] = await admin.db
      .insert(resourceRequests)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        roleTitle: 'UX Writer (teste)',
        hours: '40.00',
        startDate: '2027-11-08',
        endDate: '2027-11-12',
        status: 'open',
        createdBy: ana,
      })
      .returning();
    await admin.db.insert(notificationPreferences).values({
      tenantId: demo.tenantId,
      userId: fernanda,
      channel: 'email',
      eventType: 'resource_request',
      frequency: 'instant',
      createdBy: fernanda,
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
    const created = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'resource_request.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { requestId: request?.id, boardId: demo.boardId, change: 'created' },
        }),
      ),
    );
    expect(created.notified).toBe(3);
    const createdRows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, request?.id ?? ''));
    expect(new Set(createdRows.map((row) => row.userId))).toEqual(new Set([ana, carlos, fernanda]));

    await queues[QUEUES.emails].obliterate({ force: true });
    const fulfilled = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'resource_request.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { requestId: request?.id, boardId: demo.boardId, change: 'fulfilled' },
        }),
      ),
    );
    expect(fulfilled.notified).toBe(1);
    const fulfilledJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(fulfilledJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'fernanda.souza@empresademo.com.br', template: 'resource_request_fulfilled' }),
    );

    await queues[QUEUES.emails].obliterate({ force: true });
    const cancelled = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'resource_request.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { requestId: request?.id, boardId: demo.boardId, change: 'cancelled' },
        }),
      ),
    );
    expect(cancelled.notified).toBe(1);
    const cancelledJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(cancelledJobs).toHaveLength(0);
  });

  it('timesheet enviado notifica o gestor direto; aprovado/recusado notifica quem enviou', async () => {
    const rafael = demo.users['rafael.mendes'] ?? '';
    const carlos = demo.users['carlos.lima'] ?? '';
    const [approval] = await admin.db
      .insert(timesheetApprovals)
      .values({
        tenantId: demo.tenantId,
        userId: rafael,
        periodStart: '2027-11-15',
        periodEnd: '2027-11-21',
        status: 'submitted',
        totalMinutes: 2400,
        submittedAt: new Date(),
        createdBy: rafael,
      })
      .returning();
    await admin.db.insert(notificationPreferences).values([
      { tenantId: demo.tenantId, userId: carlos, channel: 'email', eventType: 'timesheet', frequency: 'instant', createdBy: carlos },
      { tenantId: demo.tenantId, userId: rafael, channel: 'email', eventType: 'timesheet', frequency: 'instant', createdBy: rafael },
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
    const submitted = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'timesheet_approval.changed',
          actorId: rafael,
          payload: { approvalId: approval?.id, userId: rafael, periodStart: '2027-11-15', status: 'submitted' },
        }),
      ),
    );
    expect(submitted.notified).toBe(1);
    const submittedRows = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, approval?.id ?? ''));
    expect(submittedRows.map((row) => row.userId)).toEqual([carlos]);
    const submittedJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(submittedJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'carlos.lima@empresademo.com.br', template: 'timesheet_submitted' }),
    );

    await queues[QUEUES.emails].obliterate({ force: true });
    const decided = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'timesheet_approval.changed',
          actorId: carlos,
          payload: { approvalId: approval?.id, userId: rafael, periodStart: '2027-11-15', status: 'approved' },
        }),
      ),
    );
    expect(decided.notified).toBe(1);
    const decidedJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(decidedJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'rafael.mendes@empresademo.com.br', template: 'timesheet_decided' }),
    );
  });
});

describe('portfólio: RAG automático, EVM e notificações (ADR 0053)', () => {
  it('recalcula a saúde do board ao consumir um evento de risco e grava uma linha automática', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    await admin.db
      .delete(healthRuleSets)
      .where(and(eq(healthRuleSets.tenantId, demo.tenantId), eq(healthRuleSets.boardId, demo.boardId)));
    await admin.db.insert(healthRuleSets).values({
      tenantId: demo.tenantId,
      boardId: demo.boardId,
      rules: [{ dimension: 'risk', metric: 'open_critical_risks', operator: 'gte', threshold: 1, result: 'red' }],
      createdBy: ana,
    });
    const [risk] = await admin.db
      .insert(risks)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        title: 'Risco crítico de teste (worker)',
        probability: 5,
        impact: 5,
        status: 'open',
        createdBy: ana,
      })
      .returning();

    const process = portfolioProcessor({ database: app, redis, logger: silentLogger });
    const result = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'risk.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { riskId: risk?.id, boardId: demo.boardId, change: 'created' },
        }),
      ),
    );
    expect(result.status).toBe('applied');

    const [latest] = await admin.db
      .select()
      .from(projectHealth)
      .where(eq(projectHealth.boardId, demo.boardId))
      .orderBy(desc(projectHealth.reportedAt))
      .limit(1);
    expect(latest?.isAutomatic).toBe(true);
    expect(latest?.risk).toBe('red');
    expect(latest?.overall).toBe('red');

    await admin.db.delete(risks).where(eq(risks.id, risk?.id ?? ''));
  });

  it('EVM: BAC=1000, 50% concluído e AC=400 produz EV=500, CPI=1.25', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const [budget] = await admin.db
      .insert(budgets)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        name: 'Orçamento de teste (worker)',
        plannedAmount: '1000.00',
        createdBy: ana,
      })
      .returning();
    await admin.db.insert(costEntries).values({
      tenantId: demo.tenantId,
      budgetId: budget?.id ?? '',
      boardId: demo.boardId,
      entryDate: '2026-01-15',
      amount: '400.00',
      kind: 'actual',
      source: 'manual',
      createdBy: ana,
    });
    // Zera o progresso dos itens de nível superior do board e marca metade com 100% — média = 50%.
    const topLevel = await admin.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.boardId, demo.boardId), eq(items.tenantId, demo.tenantId)));
    const toMark = topLevel.slice(0, Math.ceil(topLevel.length / 2)).map((row) => row.id);
    const toZero = topLevel.slice(Math.ceil(topLevel.length / 2)).map((row) => row.id);
    if (toMark.length > 0) await admin.db.update(items).set({ progress: '100.00' }).where(inArray(items.id, toMark));
    if (toZero.length > 0) await admin.db.update(items).set({ progress: '0.00' }).where(inArray(items.id, toZero));

    const process = portfolioProcessor({ database: app, redis, logger: silentLogger });
    await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'cost_entry.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { costEntryId: newId(), budgetId: budget?.id, boardId: demo.boardId, change: 'created' },
        }),
      ),
    );

    const [latest] = await admin.db
      .select()
      .from(projectHealth)
      .where(eq(projectHealth.boardId, demo.boardId))
      .orderBy(desc(projectHealth.reportedAt))
      .limit(1);
    expect(latest?.earnedValue).toBe('500.00');
    expect(latest?.actualCost).toBe('400.00');
    expect(Number(latest?.cpi)).toBeCloseTo(1.25, 2);

    await admin.db.delete(costEntries).where(eq(costEntries.budgetId, budget?.id ?? ''));
    await admin.db.delete(budgets).where(eq(budgets.id, budget?.id ?? ''));
  });

  it('risco criado com responsável notifica o responsável (risk_assigned)', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const rafael = demo.users['rafael.mendes'] ?? '';
    const [risk] = await admin.db
      .insert(risks)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        title: 'Risco atribuído (teste)',
        probability: 3,
        impact: 3,
        status: 'open',
        ownerId: rafael,
        createdBy: ana,
      })
      .returning();
    await admin.db.insert(notificationPreferences).values({
      tenantId: demo.tenantId,
      userId: rafael,
      channel: 'email',
      eventType: 'risk',
      frequency: 'instant',
      createdBy: rafael,
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
          type: 'risk.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { riskId: risk?.id, boardId: demo.boardId, change: 'created' },
        }),
      ),
    );
    expect(result.notified).toBe(1);
    const emailJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(emailJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'rafael.mendes@empresademo.com.br', template: 'risk_assigned' }),
    );

    await admin.db.delete(risks).where(eq(risks.id, risk?.id ?? ''));
  });

  it('problema criado com responsável notifica o responsável (issue_assigned)', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const juliana = demo.users['juliana.castro'] ?? '';
    const [issue] = await admin.db
      .insert(issues)
      .values({
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        title: 'Problema atribuído (teste)',
        severity: 'high',
        status: 'open',
        ownerId: juliana,
        createdBy: ana,
      })
      .returning();
    await admin.db.insert(notificationPreferences).values({
      tenantId: demo.tenantId,
      userId: juliana,
      channel: 'email',
      eventType: 'issue',
      frequency: 'instant',
      createdBy: juliana,
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
          type: 'issue.changed',
          boardId: demo.boardId,
          actorId: ana,
          payload: { issueId: issue?.id, boardId: demo.boardId, change: 'created' },
        }),
      ),
    );
    expect(result.notified).toBe(1);
    const emailJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(emailJobs.map((job) => job.data as unknown)).toContainEqual(
      expect.objectContaining({ to: 'juliana.castro@empresademo.com.br', template: 'issue_assigned' }),
    );

    await admin.db.delete(issues).where(eq(issues.id, issue?.id ?? ''));
  });

  it('RAG automático que piora para vermelho alerta o dono do board (project_health_alert); override manual não alerta', async () => {
    const ana = demo.users['ana.ribeiro'] ?? '';
    const [board] = await admin.db.select({ ownerId: schema.boards.ownerId }).from(schema.boards).where(eq(schema.boards.id, demo.boardId));
    const ownerId = board?.ownerId;
    expect(ownerId).toBeDefined();
    if (ownerId === null || ownerId === undefined) return;
    await admin.db.insert(notificationPreferences).values({
      tenantId: demo.tenantId,
      userId: ownerId,
      channel: 'email',
      eventType: 'project_health',
      frequency: 'instant',
      createdBy: ownerId,
    });

    const [previous] = await admin.db
      .insert(projectHealth)
      .values({ tenantId: demo.tenantId, boardId: demo.boardId, overall: 'green', isAutomatic: true, createdBy: ana })
      .returning();
    const [worsened] = await admin.db
      .insert(projectHealth)
      .values({ tenantId: demo.tenantId, boardId: demo.boardId, overall: 'red', isAutomatic: true, createdBy: ana })
      .returning();

    await queues[QUEUES.emails].obliterate({ force: true });
    const process = notificationsProcessor({
      database: app,
      redis,
      emails: queues[QUEUES.emails],
      appUrl: 'http://app.test',
      jwtSecret: JWT_SECRET,
      mailReplyDomain: MAIL_REPLY_DOMAIN,
    });
    const alerted = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'project_health.changed',
          boardId: demo.boardId,
          payload: { healthId: worsened?.id, boardId: demo.boardId, overall: 'red', isAutomatic: true },
        }),
      ),
    );
    expect(alerted.notified).toBe(1);
    const emailJobs = await queues[QUEUES.emails].getJobs(['waiting', 'delayed']);
    expect(emailJobs.length).toBeGreaterThan(0);

    await queues[QUEUES.emails].obliterate({ force: true });
    const manualOverride = await process(
      fakeJob(
        domainEvent({
          eventId: newId(),
          tenantId: demo.tenantId,
          type: 'project_health.changed',
          boardId: demo.boardId,
          payload: { healthId: worsened?.id, boardId: demo.boardId, overall: 'red', isAutomatic: false },
        }),
      ),
    );
    expect(manualOverride.notified).toBe(0);

    await admin.db.delete(projectHealth).where(inArray(projectHealth.id, [previous?.id ?? '', worsened?.id ?? '']));
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
