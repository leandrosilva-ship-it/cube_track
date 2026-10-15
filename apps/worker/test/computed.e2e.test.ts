import { schema, type DatabaseHandle } from '@cube-track/db';
import { newId, positionBetween, QUEUES } from '@cube-track/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { computedProcessor, runComputed, scheduleVolatile } from '../src/processors/computed.js';
import { purgeTrash } from '../src/processors/maintenance.js';
import { createQueues, type QueueRegistry } from '../src/queues.js';
import {
  adminDb,
  appDb,
  demoContext,
  domainEvent,
  fakeJob,
  redisClient,
  type DemoContext,
} from './helpers.js';

const { items, columnDefinitions, auditLogs } = schema;

let admin: DatabaseHandle;
let app: DatabaseHandle;
let redis: Redis;
let queues: QueueRegistry;
let demo: DemoContext;
let groupId: string;

const KEYS = {
  rollup: 'c_t_rollup',
  progress: 'c_t_prog',
  relation: 'c_t_rel',
  mirror: 'c_t_mirror',
  formula: 'c_t_formula',
  today: 'c_t_today',
};

async function addColumn(key: string, type: string, settings: Record<string, unknown>) {
  await admin.db.insert(columnDefinitions).values({
    tenantId: demo.tenantId,
    boardId: demo.boardId,
    key,
    type,
    title: key,
    settings,
    position: `z${key}`,
  });
}

async function createItem(
  name: string,
  values: Record<string, Record<string, unknown>> = {},
  parentItemId: string | null = null,
) {
  const [item] = await admin.db
    .insert(items)
    .values({
      tenantId: demo.tenantId,
      boardId: demo.boardId,
      groupId,
      parentItemId,
      name,
      values,
      position: positionBetween(null, null) + newId().slice(-6),
    })
    .returning();
  if (item === undefined) throw new Error('item');
  return item;
}

async function valuesOf(id: string) {
  const [row] = await admin.db.select({ values: items.values }).from(items).where(eq(items.id, id));
  return row?.values ?? {};
}

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  redis = redisClient();
  queues = createQueues(inject('redisUrl'));
  demo = await demoContext(admin);
  groupId = Object.values(demo.groups)[0] ?? '';
  const done = demo.statusLabels['Concluído'];
  if (done === undefined) throw new Error('rótulo Concluído');
  await addColumn(KEYS.rollup, 'rollup', {
    source: 'subitems',
    targetColumnKey: 'c_ust',
    aggregate: 'sum',
  });
  await addColumn(KEYS.progress, 'progress', { mode: 'subitems', sourceColumnKeys: ['c_status'] });
  await addColumn(KEYS.relation, 'board_relation', { boardIds: [demo.boardId] });
  await addColumn(KEYS.mirror, 'mirror', {
    relationColumnKey: KEYS.relation,
    targetColumnKey: 'c_ust',
    aggregate: 'sum',
  });
  await addColumn(KEYS.formula, 'formula', { expression: `{${KEYS.mirror}} * 10` });
});

afterAll(async () => {
  await admin.db
    .delete(columnDefinitions)
    .where(
      and(
        eq(columnDefinitions.boardId, demo.boardId),
        inArray(columnDefinitions.key, Object.values(KEYS)),
      ),
    );
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  redis.disconnect();
  await Promise.all([admin.close(), app.close()]);
});

describe('colunas calculadas entre itens (worker)', () => {
  it('rollup e progresso por subitens recalculados ao criar a coluna e quando um subitem muda', async () => {
    const done = demo.statusLabels['Concluído'] ?? '';
    const parent = await createItem('Pai calculado');
    const first = await createItem(
      'Sub 1',
      { c_ust: { n: '2' }, c_status: { labelId: done } },
      parent.id,
    );
    await createItem('Sub 2', { c_ust: { n: '3.5' } }, parent.id);

    const created = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'column.created',
      boardId: demo.boardId,
    });
    await computedProcessor({ database: app, redis })(fakeJob(created));
    expect((await valuesOf(parent.id))[KEYS.rollup]).toMatchObject({ n: '5.5' });
    expect((await valuesOf(parent.id))[KEYS.progress]).toMatchObject({ n: '50' });

    await admin.db
      .update(items)
      .set({ values: { c_ust: { n: '10' }, c_status: { labelId: done } } })
      .where(eq(items.id, first.id));
    const changed = await runComputed(
      { database: app, redis },
      {
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemIds: [first.id],
        volatileOnly: false,
        causationId: null,
        depth: 0,
      },
    );
    expect(changed).toBeGreaterThanOrEqual(1);
    expect((await valuesOf(parent.id))[KEYS.rollup]).toMatchObject({ n: '13.5' });
    const [event] = await admin.db
      .execute<{
        payload: { changes: { field: string }[] };
      }>(sql`select payload from outbox_events where item_id = ${parent.id}::uuid order by created_at desc limit 1`)
      .then((result) => result.rows);
    expect(event?.payload.changes.map((change) => change.field)).toContain(KEYS.rollup);
  });

  it('espelho por relação e fórmula que depende dele propagam quando o item relacionado muda', async () => {
    const source = await createItem('Origem', { c_ust: { n: '4' } });
    const dependent = await createItem('Dependente', { [KEYS.relation]: { itemIds: [source.id] } });
    const request = {
      tenantId: demo.tenantId,
      boardId: demo.boardId,
      volatileOnly: false,
      causationId: null,
      depth: 0,
    };
    await runComputed({ database: app, redis }, { ...request, itemIds: [dependent.id] });
    expect((await valuesOf(dependent.id))[KEYS.mirror]).toMatchObject({ n: '4' });
    expect((await valuesOf(dependent.id))[KEYS.formula]).toMatchObject({ n: '40' });

    await admin.db
      .update(items)
      .set({ values: { c_ust: { n: '6' } } })
      .where(eq(items.id, source.id));
    await runComputed({ database: app, redis }, { ...request, itemIds: [source.id] });
    expect((await valuesOf(dependent.id))[KEYS.mirror]).toMatchObject({ n: '6' });
    expect((await valuesOf(dependent.id))[KEYS.formula]).toMatchObject({ n: '60' });
  });

  it('cadeias param na profundidade máxima (proteção contra laços)', async () => {
    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.updated',
      boardId: demo.boardId,
      itemId: newId(),
      depth: 5,
    });
    await expect(
      computedProcessor({ database: app, redis })(fakeJob(event)),
    ).resolves.toBeUndefined();
  });

  it('fórmulas voláteis (TODAY) são agendadas por board', async () => {
    await addColumn(KEYS.today, 'formula', { expression: 'DAYS(TODAY(), DATE(2026, 1, 1))' });
    const item = await createItem('Volátil');
    const queue = queues[QUEUES.computed];
    await queue.drain();
    expect(await scheduleVolatile(app, queue)).toBeGreaterThanOrEqual(1);
    const waiting = await queue.getJobs(['waiting']);
    expect(
      waiting.some(
        (job) => (job.data as { boardId: string; volatileOnly: boolean }).boardId === demo.boardId,
      ),
    ).toBe(true);
    await runComputed(
      { database: app, redis },
      {
        tenantId: demo.tenantId,
        boardId: demo.boardId,
        itemIds: [],
        volatileOnly: true,
        causationId: null,
        depth: 0,
      },
    );
    const value = (await valuesOf(item.id))[KEYS.today] as { n?: string } | undefined;
    expect(Number(value?.n)).toBeGreaterThan(200);
    await queue.drain();
  });
});

describe('lixeira', () => {
  it('expurga itens excluídos há mais de 30 dias e audita por tenant', async () => {
    const old = await createItem('Excluído antigo');
    const recent = await createItem('Excluído recente');
    await admin.db
      .update(items)
      .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(items.id, old.id));
    await admin.db
      .update(items)
      .set({ deletedAt: new Date(Date.now() - 86_400_000) })
      .where(eq(items.id, recent.id));
    const totals = await purgeTrash(app);
    expect(totals.get(demo.tenantId)?.items).toBeGreaterThanOrEqual(1);
    const remaining = await admin.db
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.id, [old.id, recent.id]));
    expect(remaining.map((row) => row.id)).toEqual([recent.id]);
    const [audit] = await admin.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, demo.tenantId), eq(auditLogs.action, 'trash.purged')));
    expect(audit?.action).toBe('trash.purged');
  });
});
