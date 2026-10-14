import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appendAuditLog } from '../src/audit.js';
import { withTenant, type DatabaseHandle } from '../src/client.js';
import { auditLogs } from '../src/schema/index.js';
import {
  adminDatabase,
  appDatabase,
  createSmallTenant,
  expectPgError,
  type SmallTenant,
} from './helpers.js';

describe('Auditoria append-only com hash encadeado', () => {
  let app: DatabaseHandle;
  let admin: DatabaseHandle;
  let tenant: SmallTenant;

  beforeAll(async () => {
    app = appDatabase();
    admin = adminDatabase();
    tenant = await createSmallTenant(app.db, `audit-${Date.now()}`);
    await withTenant(app.db, { tenantId: tenant.tenantId, userId: tenant.userId }, async (tx) => {
      for (let index = 0; index < 5; index += 1) {
        await appendAuditLog(tx, {
          tenantId: tenant.tenantId,
          actorId: tenant.userId,
          action: 'item.updated',
          entityType: 'item',
          entityId: tenant.itemId,
          before: { name: `v${index}` },
          after: { name: `v${index + 1}` },
          ip: '200.144.10.1',
          requestId: `req-${index}`,
        });
      }
    });
  });

  afterAll(async () => {
    await app.close();
    await admin.close();
  });

  it('encadeia os registros por tenant com sequência contínua', async () => {
    const rows = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx
        .select({ seq: auditLogs.chainSeq, hash: auditLogs.hash, prev: auditLogs.prevHash })
        .from(auditLogs)
        .orderBy(auditLogs.chainSeq),
    );
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]?.prev).toBeNull();
    rows.slice(1).forEach((row, index) => {
      expect(row.prev).toBe(rows[index]?.hash);
    });
    const broken = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx.execute(sql`select * from app.verify_audit_chain(${tenant.tenantId}::uuid)`),
    );
    expect(broken.rows).toHaveLength(0);
  });

  it('a aplicação não pode alterar nem excluir registros', async () => {
    await expectPgError(
      withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
        tx.update(auditLogs).set({ action: 'adulterado' }),
      ),
      ['42501'],
    );
    await expectPgError(
      withTenant(app.db, { tenantId: tenant.tenantId }, (tx) => tx.delete(auditLogs)),
      ['42501'],
    );
  });

  it('nem o dono do schema consegue alterar, excluir ou truncar (trigger)', async () => {
    await expectPgError(
      admin.db.execute(
        sql`update audit_logs set action = 'x' where tenant_id = ${tenant.tenantId}::uuid`,
      ),
      ['42501'],
    );
    await expectPgError(
      admin.db.execute(sql`delete from audit_logs where tenant_id = ${tenant.tenantId}::uuid`),
      ['42501'],
    );
    await expectPgError(admin.db.execute(sql`truncate audit_logs`), ['42501']);
  });

  it('a aplicação não acessa partições diretamente', async () => {
    const partition = await admin.db.execute<{ name: string }>(sql`
      select inhrelid::regclass::text as name from pg_inherits
      where inhparent = 'public.audit_logs'::regclass order by 1 desc limit 1`);
    const name = partition.rows[0]?.name ?? 'audit_logs_default';
    await expectPgError(
      withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
        tx.execute(sql.raw(`select * from ${name}`)),
      ),
      ['42501'],
    );
  });

  it('não grava auditoria em nome de outro tenant', async () => {
    const other = await createSmallTenant(app.db, `audit-other-${Date.now()}`);
    await expectPgError(
      withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
        appendAuditLog(tx, { tenantId: other.tenantId, action: 'x', entityType: 'item' }),
      ),
      ['42501'],
    );
  });

  it('detecta adulteração feita por fora dos controles', async () => {
    await admin.db.execute(sql`alter table audit_logs disable trigger audit_logs_append_only`);
    try {
      await admin.db.execute(
        sql`update audit_logs set after = '{"name":"adulterado"}'::jsonb where tenant_id = ${tenant.tenantId}::uuid and chain_seq = 3`,
      );
    } finally {
      await admin.db.execute(sql`alter table audit_logs enable trigger audit_logs_append_only`);
    }
    const broken = await withTenant(app.db, { tenantId: tenant.tenantId }, (tx) =>
      tx.execute<{ chain_seq: string }>(
        sql`select chain_seq from app.verify_audit_chain(${tenant.tenantId}::uuid)`,
      ),
    );
    expect(broken.rows.map((row) => Number(row.chain_seq))).toEqual([3]);
  });
});
