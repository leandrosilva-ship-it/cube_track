import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  demoIds,
  requiredValues,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

interface GanttTask {
  id: string;
  groupId: string;
  wbs: string | null;
  start: string | null;
  end: string | null;
  isMilestone: boolean;
  scheduleMode: 'auto' | 'manual';
}
interface GanttDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}
interface CriticalPathEntry {
  id: string;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatDays: number;
  isCritical: boolean;
}
interface GanttResponse {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  criticalPath: CriticalPathEntry[];
  calendar: { workingDays: number[]; holidays: string[] };
}

describe('Planning — dados do Gantt (EAP, dependências, caminho crítico) e marcos/agendamento', () => {
  let server: ApiServer;
  let api: ApiClient;
  let token: string;
  let boardId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    token = await api.login(USERS.fernanda);
    ({ boardId } = await demoIds(api, token));
  });

  afterAll(async () => {
    await server.close();
  });

  it('retorna tarefas com EAP, as 5 dependências do seed e caminho crítico consistente', async () => {
    const response = await api.get<GanttResponse>(`/v1/boards/${boardId}/gantt`, { token });
    expect(response.status).toBe(200);
    const { tasks, dependencies, criticalPath, calendar } = response.body;
    expect(tasks.length).toBeGreaterThan(0);
    expect(dependencies).toHaveLength(5);
    expect(calendar.workingDays.length).toBeGreaterThan(0);

    const wbsPattern = /^\d+(\.\d+)*$/;
    for (const task of tasks) {
      expect(task.wbs).not.toBeNull();
      expect(task.wbs ?? '').toMatch(wbsPattern);
    }
    // EAP não tem números repetidos (cada item tem uma posição única na hierarquia).
    expect(new Set(tasks.map((task) => task.wbs)).size).toBe(tasks.length);

    const taskIds = new Set(tasks.map((task) => task.id));
    for (const link of dependencies) {
      expect(taskIds.has(link.predecessorId)).toBe(true);
      expect(taskIds.has(link.successorId)).toBe(true);
    }

    // O caminho crítico cobre todas as tarefas datadas (CPM sobre o cronograma vigente).
    const dated = tasks.filter((task) => task.start !== null && task.end !== null);
    expect(criticalPath.length).toBe(dated.length);
    for (const entry of criticalPath) {
      expect(entry.earlyStart <= entry.earlyFinish).toBe(true);
      expect(entry.lateStart <= entry.lateFinish).toBe(true);
      expect(entry.earlyStart <= entry.lateStart).toBe(true);
      expect(entry.isCritical).toBe(entry.totalFloatDays <= 0);
    }
    // Pelo menos uma tarefa está no caminho crítico (a que define o fim do projeto).
    expect(criticalPath.some((entry) => entry.isCritical)).toBe(true);
  });

  it('marca um item como marco e alterna o modo de agendamento via PATCH', async () => {
    const { board } = await demoIds(api, token);
    const groupId = board.groups[0]?.id ?? '';
    const created = await api.post<{ id: string; isMilestone: boolean; scheduleMode: string }>(
      `/v1/boards/${boardId}/items`,
      {
        token,
        body: {
          groupId,
          name: 'Marco de teste — entrega do módulo',
          values: requiredValues(board),
          isMilestone: true,
        },
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.isMilestone).toBe(true);
    expect(created.body.scheduleMode).toBe('auto');

    const gantt = await api.get<GanttResponse>(`/v1/boards/${boardId}/gantt`, { token });
    const marco = gantt.body.tasks.find((task) => task.id === created.body.id);
    expect(marco?.isMilestone).toBe(true);

    const patched = await api.patch<{
      id: string;
      version: number;
      isMilestone: boolean;
      scheduleMode: string;
    }>(`/v1/items/${created.body.id}`, {
      token,
      body: { scheduleMode: 'manual', isMilestone: false },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.scheduleMode).toBe('manual');
    expect(patched.body.isMilestone).toBe(false);
    expect(patched.body.version).toBeGreaterThan(1);

    const rejected = await api.patch(`/v1/items/${created.body.id}`, {
      token,
      body: { scheduleMode: 'invalido' },
    });
    expect(rejected.status).toBe(400);

    await api.delete(`/v1/items/${created.body.id}`, { token });
  });

  it('CRUD de marcos (criar, listar, atualizar status, excluir)', async () => {
    const created = await api.post<{
      id: string;
      boardId: string;
      status: string;
      achievedAt: string | null;
    }>(`/v1/boards/${boardId}/milestones`, {
      token,
      body: { name: 'Go-live do módulo de teste', dueDate: '2026-12-01' },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    expect(created.body.achievedAt).toBeNull();

    const list = await api.get<{ data: { id: string }[] }>(`/v1/boards/${boardId}/milestones`, {
      token,
    });
    expect(list.status).toBe(200);
    expect(list.body.data.some((entry) => entry.id === created.body.id)).toBe(true);

    const achieved = await api.patch<{ status: string; achievedAt: string | null }>(
      `/v1/milestones/${created.body.id}`,
      { token, body: { status: 'achieved' } },
    );
    expect(achieved.status).toBe(200);
    expect(achieved.body.status).toBe('achieved');
    expect(achieved.body.achievedAt).not.toBeNull();

    const reopened = await api.patch<{ status: string; achievedAt: string | null }>(
      `/v1/milestones/${created.body.id}`,
      { token, body: { status: 'pending' } },
    );
    expect(reopened.body.status).toBe('pending');
    expect(reopened.body.achievedAt).toBeNull();

    const removed = await api.delete(`/v1/milestones/${created.body.id}`, { token });
    expect(removed.status).toBe(204);
    const listAfter = await api.get<{ data: { id: string }[] }>(
      `/v1/boards/${boardId}/milestones`,
      { token },
    );
    expect(listAfter.body.data.some((entry) => entry.id === created.body.id)).toBe(false);
  });

  it('captura uma baseline, lista, compara por item e marca como primária', async () => {
    // O seed já tem uma baseline primária (ADR 0049); restauramos ao final para não afetar outros testes.
    const before = await api.get<{ data: { id: string; isPrimary: boolean }[] }>(
      `/v1/boards/${boardId}/baselines`,
      { token },
    );
    const originalPrimaryId = before.body.data.find((entry) => entry.isPrimary)?.id ?? null;

    const captured = await api.post<{ id: string; boardId: string; isPrimary: boolean }>(
      `/v1/boards/${boardId}/baselines`,
      { token, body: { name: 'Baseline de teste — captura automatizada' } },
    );
    expect(captured.status).toBe(201);
    expect(captured.body.isPrimary).toBe(false);

    const list = await api.get<{ data: { id: string; name: string }[] }>(
      `/v1/boards/${boardId}/baselines`,
      { token },
    );
    expect(list.body.data.some((entry) => entry.id === captured.body.id)).toBe(true);

    const detail = await api.get<{
      items: {
        itemId: string;
        baselineStartDate: string | null;
        plannedStartDate: string | null;
      }[];
    }>(`/v1/baselines/${captured.body.id}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.body.items.length).toBeGreaterThan(0);
    // A captura fotografa o planejado vigente: baseline e planejado atual coincidem no instante da captura.
    for (const row of detail.body.items) {
      expect(row.baselineStartDate).toBe(row.plannedStartDate);
    }

    const primary = await api.post<{ isPrimary: boolean }>(
      `/v1/baselines/${captured.body.id}/primary`,
      { token },
    );
    expect(primary.status).toBe(200);
    expect(primary.body.isPrimary).toBe(true);

    await api.delete(`/v1/baselines/${captured.body.id}`, { token });
    if (originalPrimaryId !== null) {
      await api.post(`/v1/baselines/${originalPrimaryId}/primary`, { token });
    }
  });

  it('importa um cronograma MS Project (.xml/MSPDI): tarefas viram itens e vínculos viram dependências', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Project>
  <Tasks>
    <Task>
      <UID>0</UID>
      <Name>Projeto inteiro</Name>
    </Task>
    <Task>
      <UID>1</UID>
      <Name>MSP — Levantamento de requisitos</Name>
      <Start>2026-03-02T08:00:00</Start>
      <Finish>2026-03-06T17:00:00</Finish>
      <Milestone>0</Milestone>
    </Task>
    <Task>
      <UID>2</UID>
      <Name>MSP — Desenvolvimento</Name>
      <Start>2026-03-09T08:00:00</Start>
      <Finish>2026-03-20T17:00:00</Finish>
      <Milestone>0</Milestone>
      <PredecessorLink>
        <PredecessorUID>1</PredecessorUID>
        <Type>1</Type>
        <LinkLag>0</LinkLag>
      </PredecessorLink>
    </Task>
    <Task>
      <UID>3</UID>
      <Name>MSP — Go-live</Name>
      <Start>2026-03-23T08:00:00</Start>
      <Finish>2026-03-23T08:00:00</Finish>
      <Milestone>1</Milestone>
      <PredecessorLink>
        <PredecessorUID>2</PredecessorUID>
        <Type>1</Type>
        <LinkLag>0</LinkLag>
      </PredecessorLink>
    </Task>
  </Tasks>
</Project>`;
    const { board } = await demoIds(api, token);
    const groupId = board.groups[0]?.id ?? '';

    const preview = await api.post<{
      importId: string;
      totalTasks: number;
      dependencyCount: number;
      sample: { name: string; milestone: boolean }[];
    }>(`/v1/boards/${boardId}/schedule-imports`, {
      token,
      body: { fileName: 'cronograma.xml', contentBase64: Buffer.from(xml).toString('base64') },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.totalTasks).toBe(3);
    expect(preview.body.dependencyCount).toBe(2);
    expect(preview.body.sample.some((task) => task.milestone)).toBe(true);

    const commit = await api.post<{
      created: number;
      skipped: number;
      dependenciesCreated: number;
      errors: unknown[];
    }>(`/v1/boards/${boardId}/schedule-imports/${preview.body.importId}/commit`, {
      token,
      body: { groupId },
    });
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(3);
    expect(commit.body.dependenciesCreated).toBe(2);
    expect(commit.body.errors).toEqual([]);

    const items = await api.get<{
      data: { id: string; name: string; plannedStartDate: string | null; isMilestone: boolean }[];
    }>(`/v1/boards/${boardId}/items?limit=100&search=MSP`, { token });
    const imported = items.body.data.filter((item) => item.name.startsWith('MSP —'));
    expect(imported).toHaveLength(3);
    const goLive = imported.find((item) => item.name.endsWith('Go-live'));
    expect(goLive?.isMilestone).toBe(true);

    for (const item of imported) await api.delete(`/v1/items/${item.id}`, { token });

    const reused = await api.post(
      `/v1/boards/${boardId}/schedule-imports/${preview.body.importId}/commit`,
      { token, body: { groupId } },
    );
    expect(reused.status).toBe(404);
  });
});
