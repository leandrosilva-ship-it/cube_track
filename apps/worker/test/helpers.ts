import { DEMO_TENANT_SLUG, createDatabase, schema, type DatabaseHandle } from '@cube-track/db';
import type { DomainEventJob } from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { inject } from 'vitest';

import { logger } from '../src/logger.js';

export const silentLogger = logger.child({});
silentLogger.level = 'silent';

export function adminDb(): DatabaseHandle {
  return createDatabase(inject('adminUrl'), { max: 2 });
}
export function appDb(): DatabaseHandle {
  return createDatabase(inject('appUrl'), { max: 4 });
}
export function relayDb(): DatabaseHandle {
  return createDatabase(inject('relayUrl'), { max: 2 });
}
export function redisClient(): Redis {
  return new Redis(inject('redisUrl'), { maxRetriesPerRequest: null });
}

/** Job mínimo para chamar processadores diretamente (sem fila). */
export function fakeJob<T>(data: T, id = 'test-job'): Job<T> {
  return { id, data, name: 'test', attemptsMade: 0, opts: {} } as unknown as Job<T>;
}

export interface DemoContext {
  tenantId: string;
  workspaceId: string;
  boardId: string;
  groups: Record<string, string>;
  users: Record<string, string>;
  statusLabels: Record<string, string>;
}

/** Ids da Empresa Demo (board PMSP) lidos com o papel dono. */
export async function demoContext(admin: DatabaseHandle): Promise<DemoContext> {
  const [tenant] = await admin.db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, DEMO_TENANT_SLUG));
  if (tenant === undefined) throw new Error('Tenant demo ausente');
  const [board] = await admin.db
    .select()
    .from(schema.boards)
    .where(
      and(
        eq(schema.boards.tenantId, tenant.id),
        eq(schema.boards.name, 'PMSP'),
        isNull(schema.boards.deletedAt),
      ),
    );
  if (board === undefined) throw new Error('Board PMSP ausente');
  const groups = await admin.db
    .select()
    .from(schema.groups)
    .where(eq(schema.groups.boardId, board.id));
  const users = await admin.db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users);
  const [statusColumn] = await admin.db
    .select()
    .from(schema.columnDefinitions)
    .where(
      and(
        eq(schema.columnDefinitions.boardId, board.id),
        eq(schema.columnDefinitions.key, 'c_status'),
      ),
    );
  const labels =
    statusColumn === undefined
      ? []
      : await admin.db
          .select()
          .from(schema.statusLabels)
          .where(eq(schema.statusLabels.columnId, statusColumn.id));
  return {
    tenantId: tenant.id,
    workspaceId: board.workspaceId,
    boardId: board.id,
    groups: Object.fromEntries(groups.map((group) => [group.name, group.id])),
    users: Object.fromEntries(
      users.map((user) => [user.email.split('@')[0] ?? user.email, user.id]),
    ),
    statusLabels: Object.fromEntries(labels.map((label) => [label.label, label.id])),
  };
}

export function domainEvent(
  overrides: Partial<DomainEventJob> & Pick<DomainEventJob, 'eventId' | 'tenantId' | 'type'>,
): DomainEventJob {
  return {
    boardId: null,
    itemId: null,
    actorId: null,
    actorKind: 'user',
    depth: 0,
    payload: {},
    ...overrides,
  };
}

export async function waitFor<T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('Tempo esgotado aguardando condição');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
