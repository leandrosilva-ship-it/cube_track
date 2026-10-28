import { schema } from '@cube-track/db';
import { and, eq } from 'drizzle-orm';
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

const { items, timeEntries } = schema;

interface TimeEntry {
  id: string;
  userId: string;
  boardId: string;
  itemId: string;
  entryDate: string;
  minutes: number;
  status: string;
  source: string;
  approvalId: string | null;
}
interface TimesheetApproval {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalMinutes: number;
}
interface Item {
  id: string;
  values: Record<string, unknown>;
}

describe('Timesheet — apontamento, timer do item, aprovação e export (ADR 0052)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ana: string;
  let carlos: string; // gestor com `timesheet.approve`
  let rafael: string;
  let juliana: string; // tem semana aprovada (2026-09-28) e semana enviada (2026-10-05) no seed
  let boardId: string;
  let itemId: string;
  let userIds: Record<string, string>;

  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    ana = await api.login(USERS.ana);
    carlos = await api.login(USERS.carlos);
    rafael = await api.login(USERS.rafael);
    juliana = await api.login(USERS.juliana);
    ({ boardId } = await demoIds(api, ana));
    const boardItems = await api.get<{ data: { id: string }[] }>(`/v1/boards/${boardId}/items?limit=1`, {
      token: ana,
    });
    itemId = boardItems.body.data[0]?.id ?? '';
    const members = await api.get<{ data: { userId: string; email: string }[] }>('/v1/members', {
      token: ana,
    });
    userIds = Object.fromEntries(members.body.data.map((member) => [member.email, member.userId]));
  });

  afterAll(async () => {
    await db.close();
    await server.close();
  });

  describe('Apontamentos manuais', () => {
    let entryId: string;

    it('lança, atualiza, lista e exclui um apontamento manual', async () => {
      const created = await api.post<TimeEntry>('/v1/time-entries', {
        token: rafael,
        body: { boardId, itemId, entryDate: '2027-01-12', minutes: 120, description: 'Execução e2e' },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.source).toBe('manual');
      expect(created.body.status).toBe('draft');
      entryId = created.body.id;

      const updated = await api.patch<TimeEntry>(`/v1/time-entries/${entryId}`, {
        token: rafael,
        body: { minutes: 90 },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.minutes).toBe(90);

      const forItem = await api.get<{ data: TimeEntry[] }>(`/v1/items/${itemId}/time-entries`, {
        token: rafael,
      });
      expect(forItem.body.data.some((entry) => entry.id === entryId)).toBe(true);

      const removed = await api.delete(`/v1/time-entries/${entryId}`, { token: rafael });
      expect(removed.status).toBe(204);
    });

    it('rejeita minutos fora da faixa e item que não pertence ao board informado', async () => {
      const badMinutes = await api.post('/v1/time-entries', {
        token: rafael,
        body: { boardId, itemId, entryDate: '2027-01-12', minutes: 0 },
      });
      expect(badMinutes.status).toBe(400);

      const wrongBoard = await api.post('/v1/time-entries', {
        token: rafael,
        body: { boardId: '01920000-0000-7000-8000-000000000001', itemId, entryDate: '2027-01-12', minutes: 60 },
      });
      expect(wrongBoard.status).toBe(400);
    });

    it('lança vários apontamentos de uma vez (apontamento semanal)', async () => {
      const result = await api.post<{ data: TimeEntry[] }>('/v1/time-entries/week', {
        token: juliana,
        body: {
          entries: [
            { boardId, itemId, entryDate: '2027-01-18', minutes: 240 },
            { boardId, itemId, entryDate: '2027-01-19', minutes: 240 },
          ],
        },
      });
      expect(result.status, JSON.stringify(result.body)).toBe(201);
      expect(result.body.data).toHaveLength(2);
    });

    it('bloqueia novos apontamentos numa semana já aprovada', async () => {
      // Semana de 2026-09-28 já está aprovada para juliana (seed).
      const blocked = await api.post('/v1/time-entries', {
        token: juliana,
        body: { boardId, itemId, entryDate: '2026-09-29', minutes: 60 },
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.code).toBe('period_closed');
    });

    it('listar os apontamentos de outra pessoa exige `timesheet.approve`', async () => {
      const own = await api.get<{ data: TimeEntry[] }>(
        `/v1/users/${userIds[USERS.juliana]}/time-entries?from=2026-09-01&to=2026-10-31`,
        { token: juliana },
      );
      expect(own.status).toBe(200);

      const forbidden = await api.get(
        `/v1/users/${userIds[USERS.juliana]}/time-entries?from=2026-09-01&to=2026-10-31`,
        { token: rafael },
      );
      expect(forbidden.status).toBe(403);

      const asManager = await api.get<{ data: TimeEntry[] }>(
        `/v1/users/${userIds[USERS.juliana]}/time-entries?from=2026-09-01&to=2026-10-31`,
        { token: carlos },
      );
      expect(asManager.status).toBe(200);
      expect(asManager.body.data.length).toBeGreaterThan(0);
    });

    it('exporta os apontamentos de um período em CSV', async () => {
      const exported = await api.get<string>(
        `/v1/users/${userIds[USERS.juliana]}/time-entries/export.csv?from=2026-09-28&to=2026-10-04`,
        { token: juliana },
      );
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-type')).toContain('text/csv');
    });
  });

  describe('Aprovação semanal', () => {
    it('envia a semana, bloqueia edição, e o gestor aprova (horas viram aprovadas)', async () => {
      await api.post('/v1/time-entries', {
        token: rafael,
        body: { boardId, itemId, entryDate: '2027-02-01', minutes: 300, isBillable: true },
      });

      const submitted = await api.post<TimesheetApproval>('/v1/timesheet-approvals/submit', {
        token: rafael,
        body: { periodStart: '2027-02-01' },
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
      expect(submitted.body.status).toBe('submitted');
      expect(submitted.body.totalMinutes).toBeGreaterThanOrEqual(300);
      const approvalId = submitted.body.id;

      const notAMonday = await api.post('/v1/timesheet-approvals/submit', {
        token: rafael,
        body: { periodStart: '2027-02-02' },
      });
      expect(notAMonday.status).toBe(400);

      const [lockedEntry] = await db.db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, userIds[USERS.rafael] ?? ''), eq(timeEntries.approvalId, approvalId)));
      expect(lockedEntry?.status).toBe('submitted');
      const editLocked = await api.patch(`/v1/time-entries/${lockedEntry?.id ?? ''}`, {
        token: rafael,
        body: { minutes: 10 },
      });
      expect(editLocked.status).toBe(422);
      expect(editLocked.body.code).toBe('time_entry_locked');

      const pending = await api.get<{ data: TimesheetApproval[] }>('/v1/timesheet-approvals/pending', {
        token: carlos,
      });
      expect(pending.body.data.some((entry) => entry.id === approvalId)).toBe(true);

      const pendingForbidden = await api.get('/v1/timesheet-approvals/pending', { token: rafael });
      expect(pendingForbidden.status).toBe(403);

      const decided = await api.post<TimesheetApproval>(`/v1/timesheet-approvals/${approvalId}/decide`, {
        token: carlos,
        body: { status: 'approved', comment: 'Ok' },
      });
      expect(decided.status).toBe(200);
      expect(decided.body.status).toBe('approved');

      const [approvedEntry] = await db.db
        .select()
        .from(timeEntries)
        .where(eq(timeEntries.id, lockedEntry?.id ?? ''));
      expect(approvedEntry?.status).toBe('approved');

      const redecide = await api.post(`/v1/timesheet-approvals/${approvalId}/decide`, {
        token: carlos,
        body: { status: 'rejected' },
      });
      expect(redecide.status).toBe(400);

      const listedForUser = await api.get<{ data: TimesheetApproval[] }>(
        `/v1/users/${userIds[USERS.rafael]}/timesheet-approvals`,
        { token: rafael },
      );
      expect(listedForUser.body.data.some((entry) => entry.id === approvalId)).toBe(true);
    });

    it('recusar a semana libera os apontamentos de volta para rascunho', async () => {
      await api.post('/v1/time-entries', {
        token: rafael,
        body: { boardId, itemId, entryDate: '2027-02-08', minutes: 180 },
      });
      const submitted = await api.post<TimesheetApproval>('/v1/timesheet-approvals/submit', {
        token: rafael,
        body: { periodStart: '2027-02-08' },
      });
      const rejected = await api.post<TimesheetApproval>(
        `/v1/timesheet-approvals/${submitted.body.id}/decide`,
        { token: carlos, body: { status: 'rejected', comment: 'Revisar' } },
      );
      expect(rejected.status).toBe(200);
      expect(rejected.body.status).toBe('rejected');

      const [entry] = await db.db
        .select()
        .from(timeEntries)
        .where(
          and(eq(timeEntries.userId, userIds[USERS.rafael] ?? ''), eq(timeEntries.entryDate, '2027-02-08')),
        );
      expect(entry?.status).toBe('draft');
      expect(entry?.approvalId).toBeNull();

      // Reaberto: dá para editar de novo.
      const editable = await api.patch(`/v1/time-entries/${entry?.id ?? ''}`, {
        token: rafael,
        body: { minutes: 120 },
      });
      expect(editable.status).toBe(200);
    });
  });

  describe('Cronômetro do item alimenta o timesheet', () => {
    it('ao parar o cronômetro, grava um apontamento com origem `timer`', async () => {
      const timerColumn = await api.post<{ key: string }>(`/v1/boards/${boardId}/columns`, {
        token: ana,
        body: { type: 'time_tracking', title: 'Tempo (e2e)' },
      });
      expect(timerColumn.status).toBe(201);
      const columnKey = timerColumn.body.key;

      const started = await api.post<Item>(`/v1/items/${itemId}/timer/${columnKey}`, {
        token: rafael,
        body: { action: 'start' },
      });
      expect(started.status).toBe(200);
      const runningSince = (started.body.values[columnKey] as { runningSince?: string } | undefined)
        ?.runningSince;
      expect(runningSince).toBeDefined();

      // Volta o início do cronômetro para 65 minutos atrás (direto no banco), simulando tempo decorrido
      // sem depender de um sleep real no teste.
      const pastStart = new Date(Date.now() - 65 * 60_000).toISOString();
      const [itemRow] = await db.db.select({ values: items.values }).from(items).where(eq(items.id, itemId));
      const values = { ...(itemRow?.values ?? {}) } as Record<string, Record<string, unknown>>;
      values[columnKey] = { ...values[columnKey], runningSince: pastStart };
      await db.db.update(items).set({ values }).where(eq(items.id, itemId));

      const stopped = await api.post<Item>(`/v1/items/${itemId}/timer/${columnKey}`, {
        token: rafael,
        body: { action: 'stop' },
      });
      expect(stopped.status).toBe(200);
      expect((stopped.body.values[columnKey] as { runningSince?: string }).runningSince).toBeUndefined();
      expect(Number((stopped.body.values[columnKey] as { n?: string }).n)).toBeGreaterThanOrEqual(1);

      const [timerEntry] = await db.db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, userIds[USERS.rafael] ?? ''),
            eq(timeEntries.itemId, itemId),
            eq(timeEntries.source, 'timer'),
          ),
        );
      expect(timerEntry).toBeDefined();
      expect(timerEntry?.minutes).toBeGreaterThanOrEqual(64);
      expect(timerEntry?.minutes).toBeLessThanOrEqual(66);
      expect(timerEntry?.status).toBe('draft');
    });
  });
});
