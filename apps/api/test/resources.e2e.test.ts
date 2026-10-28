import { schema } from '@cube-track/db';
import { and, desc, eq } from 'drizzle-orm';
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

const { outboxEvents } = schema;

interface ResourceProfile {
  userId: string;
  jobTitle: string | null;
  managerId: string | null;
  capacityHoursPerWeek: string;
}
interface Skill {
  id: string;
  name: string;
  category: string | null;
}
interface Allocation {
  id: string;
  userId: string;
  boardId: string;
  startDate: string;
  endDate: string;
  hoursPerDay: string;
  status: string;
}
interface Absence {
  id: string;
  userId: string;
  status: string;
}
interface ResourceRequest {
  id: string;
  status: string;
  assignedUserId: string | null;
}
interface HeatmapBucket {
  bucket: string;
  nominalHours: number;
  availableHours: number;
  allocatedHours: number;
  utilization: number;
  overallocated: boolean;
}
interface HeatmapResponse {
  rows: { userId: string; buckets: HeatmapBucket[] }[];
}

describe('Capacity, recursos e timesheet — perfis, skills, alocações, ausências, solicitações e motor de capacidade (ADR 0052)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ana: string; // workspace_admin (owner)
  let carlos: string; // workspace_admin (admin) — gestor de rafael/juliana
  let fernanda: string; // workspace_admin (member, exceção do seed)
  let rafael: string; // membro comum, sem resources.manage
  let juliana: string; // membro comum, sem resources.manage
  let thiago: string; // viewer — só board.read
  let boardId: string;
  let userIds: Record<string, string>;

  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    ana = await api.login(USERS.ana);
    carlos = await api.login(USERS.carlos);
    fernanda = await api.login(USERS.fernanda);
    rafael = await api.login(USERS.rafael);
    juliana = await api.login(USERS.juliana);
    thiago = await api.login(USERS.thiago);
    ({ boardId } = await demoIds(api, ana));
    const members = await api.get<{ data: { userId: string; email: string }[] }>('/v1/members', {
      token: ana,
    });
    userIds = Object.fromEntries(members.body.data.map((member) => [member.email, member.userId]));
  });

  afterAll(async () => {
    await db.close();
    await server.close();
  });

  describe('Perfis de recurso', () => {
    it('lista perfis do tenant só para quem tem `resources.manage`', async () => {
      const asAdmin = await api.get<{ data: ResourceProfile[] }>('/v1/resource-profiles', { token: ana });
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.body.data.some((profile) => profile.userId === userIds[USERS.rafael])).toBe(true);

      const asMember = await api.get('/v1/resource-profiles', { token: rafael });
      expect(asMember.status).toBe(403);
    });

    it('a própria pessoa vê o seu perfil; ver o de outra exige `resources.manage`', async () => {
      const own = await api.get<ResourceProfile>(`/v1/users/${userIds[USERS.rafael]}/resource-profile`, {
        token: rafael,
      });
      expect(own.status).toBe(200);
      expect(own.body.userId).toBe(userIds[USERS.rafael]);
      // Gestor de recursos (carlos, manager de rafael) do seed.
      expect(own.body.managerId).toBe(userIds[USERS.carlos]);

      const other = await api.get(`/v1/users/${userIds[USERS.juliana]}/resource-profile`, {
        token: rafael,
      });
      expect(other.status).toBe(403);
    });

    it('cria/atualiza o perfil de recurso; rejeita uma pessoa ser gestora de si mesma', async () => {
      const updated = await api.put<ResourceProfile>(
        `/v1/users/${userIds[USERS.rafael]}/resource-profile`,
        { token: ana, body: { jobTitle: 'Analista de Projetos Sênior', capacityHoursPerWeek: '32.00' } },
      );
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body.jobTitle).toBe('Analista de Projetos Sênior');
      expect(updated.body.capacityHoursPerWeek).toBe('32.00');

      const selfManager = await api.put(`/v1/users/${userIds[USERS.rafael]}/resource-profile`, {
        token: ana,
        body: { managerId: userIds[USERS.rafael] },
      });
      expect(selfManager.status).toBe(400);

      const forbidden = await api.put(`/v1/users/${userIds[USERS.rafael]}/resource-profile`, {
        token: rafael,
        body: { jobTitle: 'Tentativa' },
      });
      expect(forbidden.status).toBe(403);

      // Restaura para não afetar outros testes (capacidade assume 40h para o cenário de sobrealocação).
      await api.put(`/v1/users/${userIds[USERS.rafael]}/resource-profile`, {
        token: ana,
        body: { jobTitle: 'Analista de Projetos', capacityHoursPerWeek: '40.00' },
      });
    });
  });

  describe('Skills', () => {
    let skillId: string;

    it('qualquer pessoa autenticada lê o catálogo; só `resources.manage` cria/edita/exclui', async () => {
      const list = await api.get<{ data: Skill[] }>('/v1/skills', { token: rafael });
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body.data)).toBe(true);

      const forbidden = await api.post('/v1/skills', { token: rafael, body: { name: 'Scrum Master' } });
      expect(forbidden.status).toBe(403);

      const created = await api.post<Skill>('/v1/skills', {
        token: ana,
        body: { name: 'Scrum Master E2E', category: 'Gestão' },
      });
      expect(created.status).toBe(201);
      skillId = created.body.id;

      const duplicate = await api.post('/v1/skills', { token: ana, body: { name: 'Scrum Master E2E' } });
      expect(duplicate.status).toBe(409);

      const updated = await api.patch<Skill>(`/v1/skills/${skillId}`, {
        token: ana,
        body: { category: 'Gestão de Projetos' },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.category).toBe('Gestão de Projetos');
    });

    it('substitui as competências de uma pessoa', async () => {
      const set = await api.put<{ data: { skillId: string; level: number }[] }>(
        `/v1/users/${userIds[USERS.rafael]}/skills`,
        { token: ana, body: { entries: [{ skillId, level: 3 }] } },
      );
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(set.body.data).toEqual([expect.objectContaining({ skillId, level: 3 })]);

      const listed = await api.get<{ data: { skillId: string }[] }>(
        `/v1/users/${userIds[USERS.rafael]}/skills`,
        { token: rafael },
      );
      expect(listed.body.data.some((entry) => entry.skillId === skillId)).toBe(true);

      await api.delete(`/v1/skills/${skillId}`, { token: ana });
      const afterDelete = await api.get<{ data: Skill[] }>('/v1/skills', { token: ana });
      expect(afterDelete.body.data.some((entry) => entry.id === skillId)).toBe(false);
    });
  });

  describe('Alocações', () => {
    it('cria, lista, atualiza e exclui alocações planejadas; emite `allocation.changed`', async () => {
      const created = await api.post<Allocation>('/v1/allocations', {
        token: ana,
        body: {
          userId: userIds[USERS.rafael],
          boardId,
          startDate: '2027-03-01',
          endDate: '2027-03-05',
          hoursPerDay: '4.00',
          status: 'confirmed',
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const allocationId = created.body.id;

      const [outboxRow] = await db.db
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.eventType, 'allocation.changed'), eq(outboxEvents.aggregateId, allocationId)));
      expect(outboxRow?.payload).toMatchObject({
        allocationId,
        userId: userIds[USERS.rafael],
        boardId,
        change: 'created',
      });

      const forBoard = await api.get<{ data: Allocation[] }>(`/v1/boards/${boardId}/allocations`, {
        token: thiago, // viewer do board — board.read basta
      });
      expect(forBoard.status).toBe(200);
      expect(forBoard.body.data.some((entry) => entry.id === allocationId)).toBe(true);

      const ownAllocations = await api.get<{ data: Allocation[] }>(
        `/v1/users/${userIds[USERS.rafael]}/allocations?from=2027-02-01&to=2027-04-01`,
        { token: rafael },
      );
      expect(ownAllocations.body.data.some((entry) => entry.id === allocationId)).toBe(true);

      const othersAllocations = await api.get(
        `/v1/users/${userIds[USERS.rafael]}/allocations?from=2027-02-01&to=2027-04-01`,
        { token: juliana },
      );
      expect(othersAllocations.status).toBe(403);

      const updated = await api.patch<Allocation>(`/v1/allocations/${allocationId}`, {
        token: ana,
        body: { hoursPerDay: '6.00' },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.hoursPerDay).toBe('6.00');

      const removed = await api.delete(`/v1/allocations/${allocationId}`, { token: ana });
      expect(removed.status).toBe(204);
    });

    it('rejeita datas invertidas, horas fora da faixa e falta de permissão', async () => {
      const badDates = await api.post('/v1/allocations', {
        token: ana,
        body: {
          userId: userIds[USERS.rafael],
          boardId,
          startDate: '2027-03-10',
          endDate: '2027-03-01',
          hoursPerDay: '4.00',
        },
      });
      expect(badDates.status).toBe(400);

      const badHours = await api.post('/v1/allocations', {
        token: ana,
        body: {
          userId: userIds[USERS.rafael],
          boardId,
          startDate: '2027-03-01',
          endDate: '2027-03-05',
          hoursPerDay: '30.00',
        },
      });
      expect(badHours.status).toBe(400);

      const forbidden = await api.post('/v1/allocations', {
        token: rafael,
        body: {
          userId: userIds[USERS.rafael],
          boardId,
          startDate: '2027-03-01',
          endDate: '2027-03-05',
          hoursPerDay: '4.00',
        },
      });
      expect(forbidden.status).toBe(403);
    });
  });

  describe('Ausências', () => {
    let absenceId: string;

    it('a pessoa solicita a própria ausência; o gestor aprova; outros não podem decidir', async () => {
      const requested = await api.post<Absence>('/v1/absences', {
        token: rafael,
        body: { startDate: '2027-04-05', endDate: '2027-04-09', type: 'vacation', notes: 'Férias e2e' },
      });
      expect(requested.status, JSON.stringify(requested.body)).toBe(201);
      expect(requested.body.status).toBe('submitted');
      absenceId = requested.body.id;

      const forbiddenDecide = await api.post(`/v1/absences/${absenceId}/decide`, {
        token: juliana,
        body: { status: 'approved' },
      });
      expect(forbiddenDecide.status).toBe(403);

      const decided = await api.post<Absence>(`/v1/absences/${absenceId}/decide`, {
        token: carlos, // gestor de rafael, com `resources.manage`
        body: { status: 'approved' },
      });
      expect(decided.status).toBe(200);
      expect(decided.body.status).toBe('approved');

      const [outboxRow] = await db.db
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.eventType, 'absence.changed'), eq(outboxEvents.aggregateId, absenceId)))
        .orderBy(desc(outboxEvents.createdAt))
        .limit(1);
      expect(outboxRow?.payload).toMatchObject({ absenceId, userId: userIds[USERS.rafael], change: 'approved' });

      const listed = await api.get<{ data: Absence[] }>(`/v1/users/${userIds[USERS.rafael]}/absences`, {
        token: rafael,
      });
      expect(listed.body.data.some((entry) => entry.id === absenceId)).toBe(true);

      const redecide = await api.post(`/v1/absences/${absenceId}/decide`, {
        token: carlos,
        body: { status: 'rejected' },
      });
      expect(redecide.status).toBe(400);
    });

    it('a pessoa cancela a própria solicitação enquanto pendente', async () => {
      const requested = await api.post<Absence>('/v1/absences', {
        token: juliana,
        body: { startDate: '2027-05-03', endDate: '2027-05-04', type: 'day_off' },
      });
      const removed = await api.delete(`/v1/absences/${requested.body.id}`, { token: juliana });
      expect(removed.status).toBe(204);
    });
  });

  describe('Solicitações de recurso', () => {
    let requestId: string;

    it('gestor de projeto solicita um perfil/skill; gestor de recursos atribui', async () => {
      const created = await api.post<ResourceRequest>(`/v1/boards/${boardId}/resource-requests`, {
        token: ana, // dono do board (board.manage)
        body: {
          roleTitle: 'Analista Pleno (E2E)',
          hours: '80.00',
          startDate: '2027-06-01',
          endDate: '2027-06-30',
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      requestId = created.body.id;

      const forbiddenCreate = await api.post(`/v1/boards/${boardId}/resource-requests`, {
        token: thiago, // só board.read
        body: { roleTitle: 'X', hours: '10.00', startDate: '2027-06-01', endDate: '2027-06-02' },
      });
      expect(forbiddenCreate.status).toBe(403);

      const forBoard = await api.get<{ data: ResourceRequest[] }>(
        `/v1/boards/${boardId}/resource-requests`,
        { token: thiago },
      );
      expect(forBoard.body.data.some((entry) => entry.id === requestId)).toBe(true);

      const openAll = await api.get<{ data: ResourceRequest[] }>('/v1/resource-requests', { token: ana });
      expect(openAll.status).toBe(200);
      expect(openAll.body.data.some((entry) => entry.id === requestId)).toBe(true);

      const openForbidden = await api.get('/v1/resource-requests', { token: rafael });
      expect(openForbidden.status).toBe(403);

      const assigned = await api.post<ResourceRequest>(`/v1/resource-requests/${requestId}/assign`, {
        token: ana,
        body: { assignedUserId: userIds[USERS.rafael] },
      });
      expect(assigned.status).toBe(200);
      expect(assigned.body.status).toBe('fulfilled');
      expect(assigned.body.assignedUserId).toBe(userIds[USERS.rafael]);

      const reassign = await api.post(`/v1/resource-requests/${requestId}/assign`, {
        token: ana,
        body: { assignedUserId: userIds[USERS.juliana] },
      });
      expect(reassign.status).toBe(400);
    });

    it('cancela uma solicitação ainda aberta', async () => {
      const created = await api.post<ResourceRequest>(`/v1/boards/${boardId}/resource-requests`, {
        token: ana,
        body: { roleTitle: 'Cancelada (E2E)', hours: '20.00', startDate: '2027-07-01', endDate: '2027-07-10' },
      });
      const cancelled = await api.post<ResourceRequest>(
        `/v1/resource-requests/${created.body.id}/cancel`,
        { token: ana },
      );
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('cancelled');
    });
  });

  describe('Motor de capacidade', () => {
    it('heatmap: a própria pessoa não precisa de permissão; ver outra pessoa exige `resources.manage`/`timesheet.approve`', async () => {
      const own = await api.get<HeatmapResponse>(
        `/v1/capacity/heatmap?from=2027-08-02&to=2027-08-06&userIds=${userIds[USERS.rafael]}`,
        { token: rafael },
      );
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.rows).toHaveLength(1);

      const forbidden = await api.get(
        `/v1/capacity/heatmap?from=2027-08-02&to=2027-08-06&userIds=${userIds[USERS.juliana]}`,
        { token: rafael },
      );
      expect(forbidden.status).toBe(403);

      const asManager = await api.get<HeatmapResponse>(
        `/v1/capacity/heatmap?from=2027-08-02&to=2027-08-06&userIds=${userIds[USERS.rafael]},${userIds[USERS.juliana]}&granularity=day`,
        { token: carlos },
      );
      expect(asManager.status).toBe(200);
      expect(asManager.body.rows).toHaveLength(2);
    });

    it('sobrealocação aparece no heatmap ao criar uma alocação acima da capacidade', async () => {
      const before = await api.get<HeatmapResponse>(
        `/v1/capacity/heatmap?from=2027-09-06&to=2027-09-10&userIds=${userIds[USERS.juliana]}`,
        { token: carlos },
      );
      expect(before.body.rows[0]?.buckets.some((bucket) => bucket.overallocated)).toBe(false);

      const allocated = await api.post<Allocation>('/v1/allocations', {
        token: ana,
        body: {
          userId: userIds[USERS.juliana],
          boardId,
          startDate: '2027-09-06',
          endDate: '2027-09-10',
          hoursPerDay: '10.00',
          status: 'confirmed',
        },
      });
      expect(allocated.status).toBe(201);

      const after = await api.get<HeatmapResponse>(
        `/v1/capacity/heatmap?from=2027-09-06&to=2027-09-10&userIds=${userIds[USERS.juliana]}`,
        { token: carlos },
      );
      expect(after.body.rows[0]?.buckets.some((bucket) => bucket.overallocated)).toBe(true);

      await api.delete(`/v1/allocations/${allocated.body.id}`, { token: ana });
    });

    it('sugestões de nivelamento devolvem uma lista (mesmo vazia) sem gravar nada', async () => {
      const suggestions = await api.get<{ data: unknown[] }>(
        `/v1/capacity/leveling-suggestions?from=2027-08-02&to=2027-08-13&userIds=${userIds[USERS.rafael]}`,
        { token: ana },
      );
      expect(suggestions.status).toBe(200);
      expect(Array.isArray(suggestions.body.data)).toBe(true);
    });

    it('what-if simula sem gravar; só a própria pessoa ou quem gerencia recursos pode simular', async () => {
      const result = await api.post<{ real: HeatmapBucket[]; simulated: HeatmapBucket[] }>(
        '/v1/capacity/what-if',
        {
          token: rafael,
          body: {
            from: '2027-10-04',
            to: '2027-10-08',
            userId: userIds[USERS.rafael],
            hypotheticalAllocations: [{ startDate: '2027-10-04', endDate: '2027-10-08', hoursPerDay: '8.00' }],
          },
        },
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      const realAllocated = result.body.real.reduce((sum, bucket) => sum + bucket.allocatedHours, 0);
      const simulatedAllocated = result.body.simulated.reduce((sum, bucket) => sum + bucket.allocatedHours, 0);
      expect(simulatedAllocated).toBeGreaterThan(realAllocated);

      // Nada foi persistido: o heatmap real continua igual.
      const stillReal = await api.get<HeatmapResponse>(
        `/v1/capacity/heatmap?from=2027-10-04&to=2027-10-08&userIds=${userIds[USERS.rafael]}`,
        { token: rafael },
      );
      const stillAllocated = stillReal.body.rows[0]?.buckets.reduce((sum, bucket) => sum + bucket.allocatedHours, 0);
      expect(stillAllocated).toBeCloseTo(realAllocated, 5);

      const forbidden = await api.post('/v1/capacity/what-if', {
        token: rafael,
        body: {
          from: '2027-10-04',
          to: '2027-10-08',
          userId: userIds[USERS.juliana],
          hypotheticalAllocations: [],
        },
      });
      expect(forbidden.status).toBe(403);
    });

    it('previsão de demanda × capacidade devolve o número de baldes mensais pedido', async () => {
      const forecast = await api.get<{ data: { month: string; capacityHours: number; demandHours: number; gapHours: number }[] }>(
        '/v1/capacity/forecast?months=3',
        { token: fernanda },
      );
      expect(forecast.status, JSON.stringify(forecast.body)).toBe(200);
      expect(forecast.body.data).toHaveLength(3);

      const forbidden = await api.get('/v1/capacity/forecast?months=3', { token: rafael });
      expect(forbidden.status).toBe(403);

      const invalid = await api.get('/v1/capacity/forecast?months=4', { token: fernanda });
      expect(invalid.status).toBe(400);
    });
  });
});
