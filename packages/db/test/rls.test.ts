import { newId } from '@cube-track/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withTenant, type DatabaseHandle } from '../src/client.js';
import {
  boards,
  holidays,
  itemFieldIndex,
  items,
  shareLinks,
  tenants,
  users,
  workspaces,
} from '../src/schema/index.js';
import { DEMO_SHARE_TOKEN } from '../src/seed/context.js';
import {
  adminDatabase,
  appDatabase,
  createSmallTenant,
  ensureDemo,
  expectPgError,
  readonlyDatabase,
  type SmallTenant,
} from './helpers.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const FOREIGN_KEY_VIOLATION = '23503';

describe('Row Level Security — isolamento entre tenants', () => {
  let app: DatabaseHandle;
  let admin: DatabaseHandle;
  let demoTenantId: string;
  let other: SmallTenant;

  beforeAll(async () => {
    app = appDatabase();
    admin = adminDatabase();
    demoTenantId = await ensureDemo(app.db);
    other = await createSmallTenant(app.db, `outra-${Date.now()}`);
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
  });

  it('o papel da aplicação não é superusuário nem tem BYPASSRLS', async () => {
    const result = await app.db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('toda tabela com tenant_id obrigatório tem RLS habilitado, forçado e com política', async () => {
    const result = await admin.db.execute<{
      table_name: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(sql`
      select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnotnull and not a.attisdropped
      where c.relkind in ('r', 'p') and not c.relispartition
    `);
    expect(result.rows.length).toBeGreaterThan(80);
    const unprotected = result.rows.filter(
      (row) => !row.enabled || !row.forced || row.policies === 0,
    );
    expect(unprotected).toEqual([]);
  });

  it('sem contexto de tenant nenhuma linha é visível (fail closed)', async () => {
    const visibleItems = await app.db.select({ id: items.id }).from(items);
    const visibleTenants = await app.db.select({ id: tenants.id }).from(tenants);
    expect(visibleItems).toHaveLength(0);
    expect(visibleTenants).toHaveLength(0);
  });

  it('sem contexto de tenant não é possível inserir', async () => {
    await expectPgError(
      app.db.insert(workspaces).values({ tenantId: demoTenantId, name: 'Invasor', position: 'a0' }),
      [INSUFFICIENT_PRIVILEGE],
    );
  });

  it('cada tenant enxerga apenas os próprios dados', async () => {
    const demoView = await withTenant(app.db, { tenantId: demoTenantId }, async (tx) => ({
      tenants: await tx.select({ id: tenants.id }).from(tenants),
      items: await tx.select({ tenantId: items.tenantId }).from(items),
      otherBoard: await tx.select().from(boards).where(eq(boards.id, other.boardId)),
    }));
    expect(demoView.tenants.map((row) => row.id)).toEqual([demoTenantId]);
    expect(demoView.items.length).toBeGreaterThanOrEqual(60);
    expect(new Set(demoView.items.map((row) => row.tenantId))).toEqual(new Set([demoTenantId]));
    expect(demoView.otherBoard).toHaveLength(0);

    const otherView = await withTenant(app.db, { tenantId: other.tenantId }, async (tx) =>
      tx.select({ id: items.id }).from(items),
    );
    expect(otherView.map((row) => row.id)).toEqual([other.itemId]);
  });

  it('não permite gravar linhas com tenant_id de outro tenant', async () => {
    await expectPgError(
      withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
        tx.insert(workspaces).values({ tenantId: other.tenantId, name: 'Cruzado', position: 'a0' }),
      ),
      [INSUFFICIENT_PRIVILEGE],
    );
  });

  it('não permite referenciar registros de outro tenant (FK composta)', async () => {
    const demoBoard = await withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
      tx.select({ id: boards.id }).from(boards).where(eq(boards.name, 'PMSP')),
    );
    const demoBoardId = demoBoard[0]?.id ?? '';
    await expectPgError(
      withTenant(app.db, { tenantId: other.tenantId }, (tx) =>
        tx.insert(items).values({
          tenantId: other.tenantId,
          boardId: demoBoardId,
          groupId: other.groupId,
          name: 'Item com board alheio',
          position: 'a1',
        }),
      ),
      [FOREIGN_KEY_VIOLATION],
    );
  });

  it('UPDATE e DELETE não alcançam linhas de outro tenant', async () => {
    const outcome = await withTenant(app.db, { tenantId: demoTenantId }, async (tx) => ({
      updated: await tx
        .update(items)
        .set({ name: 'Sequestrado' })
        .where(eq(items.id, other.itemId))
        .returning(),
      deleted: await tx.delete(items).where(eq(items.id, other.itemId)).returning(),
    }));
    expect(outcome.updated).toHaveLength(0);
    expect(outcome.deleted).toHaveLength(0);
    const still = await withTenant(app.db, { tenantId: other.tenantId }, (tx) =>
      tx.select({ name: items.name }).from(items).where(eq(items.id, other.itemId)),
    );
    expect(still[0]?.name).not.toBe('Sequestrado');
  });

  it('o contexto é local à transação e não vaza pelo pool', async () => {
    const single = appDatabase();
    try {
      await withTenant(single.db, { tenantId: demoTenantId }, (tx) => tx.select().from(tenants));
      const after = await single.db.select({ id: items.id }).from(items);
      expect(after).toHaveLength(0);
    } finally {
      await single.close();
    }
  });

  it('usuários globais só são visíveis para tenants em que têm membership', async () => {
    const demoUsers = await withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    const otherUsers = await withTenant(app.db, { tenantId: other.tenantId }, (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    expect(demoUsers).toHaveLength(9);
    expect(otherUsers.map((row) => row.id)).toEqual([other.userId]);
  });

  it('a aplicação não cria usuários diretamente (apenas via app.ensure_user)', async () => {
    await expectPgError(
      withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
        tx.insert(users).values({ email: 'direto@exemplo.com', name: 'Direto' }),
      ),
      [INSUFFICIENT_PRIVILEGE],
    );
  });

  it('feriados globais são visíveis a todos; feriados de tenant ficam isolados', async () => {
    await withTenant(app.db, { tenantId: other.tenantId }, (tx) =>
      tx.insert(holidays).values({
        tenantId: other.tenantId,
        date: '2026-12-24',
        name: 'Recesso de fim de ano',
        scope: 'company',
      }),
    );
    const demoHolidays = await withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
      tx.select({ name: holidays.name, tenantId: holidays.tenantId }).from(holidays),
    );
    expect(demoHolidays.some((row) => row.name === 'Tiradentes' && row.tenantId === null)).toBe(
      true,
    );
    expect(demoHolidays.some((row) => row.name === 'Recesso de fim de ano')).toBe(false);
    await expectPgError(
      withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
        tx
          .insert(holidays)
          .values({ date: '2026-12-31', name: 'Global indevido', scope: 'national' }),
      ),
      [INSUFFICIENT_PRIVILEGE],
    );
  });

  it('a projeção tipada é somente leitura para a aplicação', async () => {
    await expectPgError(
      withTenant(app.db, { tenantId: other.tenantId }, (tx) =>
        tx.insert(itemFieldIndex).values({
          tenantId: other.tenantId,
          boardId: other.boardId,
          itemId: other.itemId,
          columnKey: 'c_fake',
          vText: 'x',
        }),
      ),
      [INSUFFICIENT_PRIVILEGE],
    );
  });

  it('o papel somente leitura respeita RLS e não grava', async () => {
    const ro = readonlyDatabase();
    try {
      const visible = await withTenant(ro.db, { tenantId: other.tenantId }, (tx) =>
        tx.select({ id: items.id }).from(items),
      );
      expect(visible.map((row) => row.id)).toEqual([other.itemId]);
      await expectPgError(
        withTenant(ro.db, { tenantId: other.tenantId }, (tx) =>
          tx.update(items).set({ name: 'x' }).where(eq(items.id, other.itemId)),
        ),
        [INSUFFICIENT_PRIVILEGE],
      );
    } finally {
      await ro.close();
    }
  });

  it('links públicos são resolvidos sem contexto via função SECURITY DEFINER', async () => {
    const tokenHash = await app.db.execute<{ hash: string }>(
      sql`select encode(sha256(${DEMO_SHARE_TOKEN}::bytea), 'hex') as hash`,
    );
    const resolved = await app.db.execute<{ tenant_id: string; resource_type: string }>(
      sql`select tenant_id, resource_type from app.resolve_share_link(${tokenHash.rows[0]?.hash ?? ''})`,
    );
    expect(resolved.rows).toEqual([{ tenant_id: demoTenantId, resource_type: 'board' }]);
    const direct = await app.db.select().from(shareLinks);
    expect(direct).toHaveLength(0);
    const missing = await app.db.execute(
      sql`select * from app.resolve_share_link(${'0'.repeat(64)})`,
    );
    expect(missing.rows).toHaveLength(0);
  });

  it('app.user_tenants lista as organizações do usuário antes do contexto', async () => {
    const someUser = await withTenant(app.db, { tenantId: demoTenantId }, (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, 'carlos.lima@empresademo.com.br')),
    );
    const result = await app.db.execute<{ tenant_id: string }>(
      sql`select tenant_id from app.user_tenants(${someUser[0]?.id ?? newId()}::uuid)`,
    );
    expect(result.rows.map((row) => row.tenant_id)).toEqual([demoTenantId]);
  });
});
