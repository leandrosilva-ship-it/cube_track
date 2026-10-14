import { DEMO_TENANT_ID } from '@cube-track/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

describe('Auditoria e log de atividade', () => {
  let server: ApiServer;
  let api: ApiClient;
  let token: string;
  let boardId: string;
  let statusLabels: string[];
  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    token = await api.login(USERS.juliana);
    const ids = await demoIds(api, token);
    boardId = ids.boardId;
    statusLabels =
      ids.board.columns
        .find((column) => column.key === 'c_status')
        ?.labels.map((label) => label.id) ?? [];
  });

  afterAll(async () => {
    await db.close();
    await server.close();
  });

  it('mutação grava auditoria (quem, o quê, antes/depois, IP, user agent), atividade e outbox na mesma transação', async () => {
    const groupId = (await demoIds(api, token)).board.groups[0]?.id ?? '';
    const created = await api.post<{ id: string }>(`/v1/boards/${boardId}/items`, {
      token,
      body: { groupId, name: 'Item auditado' },
      headers: { 'user-agent': 'cube-track-tests/1.0', 'x-request-id': 'req-auditoria-0001' },
    });
    expect(created.status).toBe(201);
    const itemId = created.body.id;
    const updated = await api.patch(`/v1/items/${itemId}`, {
      token,
      body: {
        name: 'Item auditado (renomeado)',
        values: { c_status: { labelId: statusLabels[1] } },
      },
      headers: { 'user-agent': 'cube-track-tests/1.0' },
    });
    expect(updated.status).toBe(200);

    const audit = await db.db.execute<{
      action: string;
      created_by: string;
      ip: string;
      user_agent: string;
      request_id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>(
      sql`select action, created_by, host(ip) as ip, user_agent, request_id, before, after from audit_logs
          where tenant_id = ${DEMO_TENANT_ID}::uuid and entity_id = ${itemId}::uuid order by chain_seq`,
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['item.created', 'item.updated']);
    const [createdRow, updatedRow] = audit.rows;
    expect(createdRow?.request_id).toBe('req-auditoria-0001');
    expect(updatedRow).toMatchObject({ ip: '127.0.0.1', user_agent: 'cube-track-tests/1.0' });
    expect(updatedRow?.before).toMatchObject({ name: 'Item auditado' });
    expect(updatedRow?.after).toMatchObject({
      name: 'Item auditado (renomeado)',
      c_status: { labelId: statusLabels[1] },
    });

    const activity = await db.db.execute<{ action: string; column_key: string | null }>(
      sql`select action, column_key from activity_logs where item_id = ${itemId}::uuid order by created_at, action`,
    );
    expect(activity.rows.map((row) => `${row.action}:${row.column_key ?? ''}`).sort()).toEqual(
      ['item.created:', 'item.renamed:name', 'item.value_changed:c_status'].sort(),
    );
    const outbox = await db.db.execute<{ event_type: string; seq: string }>(
      sql`select event_type, seq from outbox_events where item_id = ${itemId}::uuid order by seq`,
    );
    expect(outbox.rows.map((row) => row.event_type)).toEqual(['item.created', 'item.updated']);

    const chain = await db.db.execute(
      sql`select * from app.verify_audit_chain(${DEMO_TENANT_ID}::uuid)`,
    );
    expect(chain.rows).toHaveLength(0);
  });

  it('transação revertida não deixa auditoria nem evento', async () => {
    const before = await db.db.execute<{ total: string }>(
      sql`select count(*) as total from audit_logs where tenant_id = ${DEMO_TENANT_ID}::uuid`,
    );
    const invalid = await api.post(`/v1/boards/${boardId}/items`, {
      token,
      body: { groupId: boardId, name: 'Grupo errado' },
    });
    expect(invalid.status).toBe(400);
    const after = await db.db.execute<{ total: string }>(
      sql`select count(*) as total from audit_logs where tenant_id = ${DEMO_TENANT_ID}::uuid`,
    );
    expect(after.rows[0]?.total).toBe(before.rows[0]?.total);
  });

  it('eventos de autenticação são auditados no tenant', async () => {
    await api.login(USERS.rafael);
    const rows = await db.db.execute<{ total: string }>(
      sql`select count(*) as total from audit_logs where tenant_id = ${DEMO_TENANT_ID}::uuid and action = 'auth.login'`,
    );
    expect(Number(rows.rows[0]?.total)).toBeGreaterThan(0);
  });
});
