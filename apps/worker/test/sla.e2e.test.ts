import { schema, type DatabaseHandle } from '@cube-track/db';
import { newId, positionBetween } from '@cube-track/shared';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSlaCheck } from '../src/processors/sla.js';
import { adminDb, appDb, demoContext, redisClient, silentLogger, type DemoContext } from './helpers.js';

const { boards, groups, pipes, phases, slas, slaTrackers, slaEvents, items, notifications } = schema;

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

async function setupProcessBoard() {
  const [board] = await admin.db
    .insert(boards)
    .values({
      tenantId: demo.tenantId,
      workspaceId: demo.workspaceId,
      name: `Processo SLA ${newId()}`,
      kind: 'process',
      position: positionBetween(null, null),
    })
    .returning();
  if (board === undefined) throw new Error('falha ao criar board');
  const [group] = await admin.db
    .insert(groups)
    .values({
      tenantId: demo.tenantId,
      boardId: board.id,
      name: 'Atendimento',
      position: positionBetween(null, null),
    })
    .returning();
  if (group === undefined) throw new Error('falha ao criar grupo');
  const [pipe] = await admin.db
    .insert(pipes)
    .values({ tenantId: demo.tenantId, boardId: board.id, name: 'Pipe' })
    .returning();
  if (pipe === undefined) throw new Error('falha ao criar pipe');
  const [phase] = await admin.db
    .insert(phases)
    .values({
      tenantId: demo.tenantId,
      pipeId: pipe.id,
      groupId: group.id,
      name: 'Atendimento',
      position: positionBetween(null, null),
    })
    .returning();
  if (phase === undefined) throw new Error('falha ao criar fase');
  const [sla] = await admin.db
    .insert(slas)
    .values({
      tenantId: demo.tenantId,
      boardId: board.id,
      phaseId: phase.id,
      name: 'SLA de atendimento',
      targetMinutes: 60,
      useBusinessTime: false,
    })
    .returning();
  if (sla === undefined) throw new Error('falha ao criar sla');
  const [item] = await admin.db
    .insert(items)
    .values({
      tenantId: demo.tenantId,
      boardId: board.id,
      groupId: group.id,
      name: 'Pedido em atendimento',
      position: positionBetween(null, null),
      phaseId: phase.id,
      phaseEnteredAt: new Date(),
    })
    .returning();
  if (item === undefined) throw new Error('falha ao criar item');
  return { board, sla, item };
}

describe('Verificação periódica de SLA (ADR 0051)', () => {
  it('marca um tracker vencido como violado e grava o evento; não duplica aviso já registrado', async () => {
    const { sla, item } = await setupProcessBoard();
    const now = new Date();
    const [breachedTracker] = await admin.db
      .insert(slaTrackers)
      .values({
        tenantId: demo.tenantId,
        slaId: sla.id,
        itemId: item.id,
        status: 'running',
        startedAt: new Date(now.getTime() - 120 * 60_000),
        dueAt: new Date(now.getTime() - 60 * 60_000), // já venceu
        warningAt: new Date(now.getTime() - 90 * 60_000),
      })
      .returning();
    if (breachedTracker === undefined) throw new Error('falha ao criar tracker');

    const checkSla = createSlaCheck({ database: app, redis, logger: silentLogger });
    const result = await checkSla();

    expect(result.outcomes).toContainEqual({
      trackerId: breachedTracker.id,
      kind: 'breached',
      status: 'applied',
    });

    const [updated] = await admin.db
      .select()
      .from(slaTrackers)
      .where(eq(slaTrackers.id, breachedTracker.id));
    expect(updated?.status).toBe('breached');

    const events = await admin.db
      .select()
      .from(slaEvents)
      .where(and(eq(slaEvents.trackerId, breachedTracker.id), eq(slaEvents.type, 'breached')));
    expect(events).toHaveLength(1);

    // Rodar de novo não reaplica (tracker não está mais `running`).
    const second = await checkSla();
    expect(
      second.outcomes.find((outcome) => outcome.trackerId === breachedTracker.id),
    ).toBeUndefined();
  });

  it('registra o aviso (warningAt atingido, dueAt no futuro) uma única vez e mantém o tracker `running`', async () => {
    const { sla, item } = await setupProcessBoard();
    const now = new Date();
    const [warningTracker] = await admin.db
      .insert(slaTrackers)
      .values({
        tenantId: demo.tenantId,
        slaId: sla.id,
        itemId: item.id,
        status: 'running',
        startedAt: new Date(now.getTime() - 50 * 60_000),
        dueAt: new Date(now.getTime() + 10 * 60_000), // ainda não venceu
        warningAt: new Date(now.getTime() - 1 * 60_000), // já passou do aviso
      })
      .returning();
    if (warningTracker === undefined) throw new Error('falha ao criar tracker');

    const checkSla = createSlaCheck({ database: app, redis, logger: silentLogger });
    const first = await checkSla();
    expect(first.outcomes).toContainEqual({
      trackerId: warningTracker.id,
      kind: 'warning',
      status: 'applied',
    });

    const [afterFirst] = await admin.db
      .select()
      .from(slaTrackers)
      .where(eq(slaTrackers.id, warningTracker.id));
    expect(afterFirst?.status).toBe('running');

    const second = await checkSla();
    expect(
      second.outcomes.find((outcome) => outcome.trackerId === warningTracker.id),
    ).toBeUndefined();

    const notified = await admin.db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, warningTracker.id));
    // Sem coluna de pessoas configurada no board de teste, nenhuma notificação é gerada.
    expect(notified).toHaveLength(0);
  });
});
