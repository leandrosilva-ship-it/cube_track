import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client, demoIds, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface Dashboard {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  name: string;
  visibility: 'private' | 'workspace';
  sourceBoardIds: string[];
  canEdit: boolean;
}
interface Widget {
  id: string;
  dashboardId: string;
  type: string;
  title: string;
  config: Record<string, unknown>;
  layout: { x: number; y: number; w: number; h: number };
}
interface WidgetDataEntry {
  widgetId: string;
  type: string;
  data: Record<string, unknown>;
}
interface ProjectHealthEntry {
  id: string;
  boardId: string;
  overall: 'green' | 'yellow' | 'red' | 'grey';
}

describe('Dashboards, widgets e saúde do projeto (ADR 0050)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let other: string;
  let workspaceId: string;
  let boardId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    other = await api.login(USERS.thiago);
    ({ workspaceId, boardId } = await demoIds(api, owner));
  });

  afterAll(async () => {
    await server.close();
  });

  it('cria, lista e atualiza um dashboard com visibilidade workspace', async () => {
    const created = await api.post<Dashboard>(`/v1/workspaces/${workspaceId}/dashboards`, {
      token: owner,
      body: { name: 'Painel de teste', sourceBoardIds: [boardId] },
    });
    expect(created.status).toBe(201);
    expect(created.body.canEdit).toBe(true);
    expect(created.body.visibility).toBe('workspace');

    const list = await api.get<{ data: Dashboard[] }>(`/v1/workspaces/${workspaceId}/dashboards`, {
      token: owner,
    });
    expect(list.body.data.some((entry) => entry.id === created.body.id)).toBe(true);

    // Visibilidade workspace: outro membro lê, mas não edita (não é dono nem workspace.manage).
    const otherGet = await api.get<Dashboard>(`/v1/dashboards/${created.body.id}`, { token: other });
    expect(otherGet.status).toBe(200);
    expect(otherGet.body.canEdit).toBe(false);
    const otherPatch = await api.patch(`/v1/dashboards/${created.body.id}`, {
      token: other,
      body: { name: 'Tentativa' },
    });
    expect(otherPatch.status).toBe(403);

    const renamed = await api.patch<Dashboard>(`/v1/dashboards/${created.body.id}`, {
      token: owner,
      body: { name: 'Painel renomeado' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Painel renomeado');
  });

  it('dashboard privado não aparece para outro usuário nem é legível diretamente', async () => {
    const created = await api.post<Dashboard>(`/v1/workspaces/${workspaceId}/dashboards`, {
      token: owner,
      body: { name: 'Painel privado', visibility: 'private', sourceBoardIds: [boardId] },
    });
    expect(created.status).toBe(201);

    const otherList = await api.get<{ data: Dashboard[] }>(`/v1/workspaces/${workspaceId}/dashboards`, {
      token: other,
    });
    expect(otherList.body.data.some((entry) => entry.id === created.body.id)).toBe(false);

    const otherGet = await api.get(`/v1/dashboards/${created.body.id}`, { token: other });
    expect(otherGet.status).toBe(404);
  });

  describe('widgets e agregação de dados', () => {
    let dashboardId: string;

    beforeAll(async () => {
      const created = await api.post<Dashboard>(`/v1/workspaces/${workspaceId}/dashboards`, {
        token: owner,
        body: { name: 'Painel de widgets', sourceBoardIds: [boardId] },
      });
      dashboardId = created.body.id;
    });

    it('cria um widget number e computa a contagem de itens', async () => {
      const widget = await api.post<Widget>(`/v1/dashboards/${dashboardId}/widgets`, {
        token: owner,
        body: {
          type: 'number',
          title: 'Total de itens',
          config: { boardIds: [boardId], aggregate: 'count' },
          layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      });
      expect(widget.status).toBe(201);

      const data = await api.get<{ data: WidgetDataEntry[] }>(`/v1/dashboards/${dashboardId}/data`, {
        token: owner,
      });
      expect(data.status).toBe(200);
      const entry = data.body.data.find((row) => row.widgetId === widget.body.id);
      expect(entry).toBeDefined();
      expect(entry?.data).toMatchObject({ kind: 'number' });
      expect(Number((entry?.data as { value: string }).value)).toBeGreaterThan(0);
    });

    it('cria um widget chart_pie sobre c_status e agrupa por rótulo', async () => {
      const widget = await api.post<Widget>(`/v1/dashboards/${dashboardId}/widgets`, {
        token: owner,
        body: {
          type: 'chart_pie',
          title: 'Por status',
          config: { boardIds: [boardId], columnKey: 'c_status' },
          layout: { x: 3, y: 0, w: 6, h: 4 },
        },
      });
      expect(widget.status).toBe(201);
      const data = await api.get<{ data: WidgetDataEntry[] }>(`/v1/dashboards/${dashboardId}/data`, {
        token: owner,
      });
      const entry = data.body.data.find((row) => row.widgetId === widget.body.id);
      expect(entry?.data).toMatchObject({ kind: 'chart' });
      const categories = (entry?.data as { categories: { value: number }[] }).categories;
      expect(categories.length).toBeGreaterThan(0);
    });

    it('rejeita config inválida para o tipo do widget (422)', async () => {
      const response = await api.post(`/v1/dashboards/${dashboardId}/widgets`, {
        token: owner,
        body: {
          type: 'chart_pie',
          title: 'Sem coluna',
          config: { boardIds: [boardId] },
          layout: { x: 0, y: 4, w: 6, h: 4 },
        },
      });
      expect(response.status).toBe(422);
    });

    it('exporta os dados de um widget em CSV', async () => {
      const widget = await api.post<Widget>(`/v1/dashboards/${dashboardId}/widgets`, {
        token: owner,
        body: {
          type: 'number',
          title: 'Exportável',
          config: { boardIds: [boardId], aggregate: 'count' },
          layout: { x: 0, y: 8, w: 3, h: 2 },
        },
      });
      const csv = await api.get<string>(`/v1/widgets/${widget.body.id}/export.csv`, { token: owner });
      expect(csv.status).toBe(200);
      expect((csv.headers.get('content-type') ?? '')).toContain('csv');
    });

    it('não-dono sem workspace.manage não pode criar widget', async () => {
      const response = await api.post(`/v1/dashboards/${dashboardId}/widgets`, {
        token: other,
        body: {
          type: 'number',
          title: 'Negado',
          config: { boardIds: [boardId], aggregate: 'count' },
          layout: { x: 0, y: 12, w: 3, h: 2 },
        },
      });
      expect(response.status).toBe(403);
    });
  });

  describe('saúde do projeto', () => {
    it('board.manage relata; board.read apenas lê o histórico', async () => {
      const reported = await api.post<ProjectHealthEntry>(`/v1/boards/${boardId}/project-health`, {
        token: owner,
        body: { overall: 'yellow', schedule: 'red', percentComplete: 42, summary: 'Atraso na frente X.' },
      });
      expect(reported.status).toBe(201);
      expect(reported.body.overall).toBe('yellow');

      const history = await api.get<{ data: ProjectHealthEntry[] }>(`/v1/boards/${boardId}/project-health`, {
        token: other,
      });
      expect(history.status).toBe(200);
      expect(history.body.data.some((entry) => entry.id === reported.body.id)).toBe(true);

      const deniedReport = await api.post(`/v1/boards/${boardId}/project-health`, {
        token: other,
        body: { overall: 'green' },
      });
      expect(deniedReport.status).toBe(403);
    });

    it('widget project_health reflete o último relato', async () => {
      const dashboard = await api.post<Dashboard>(`/v1/workspaces/${workspaceId}/dashboards`, {
        token: owner,
        body: { name: 'Painel de saúde', sourceBoardIds: [boardId] },
      });
      const widget = await api.post<Widget>(`/v1/dashboards/${dashboard.body.id}/widgets`, {
        token: owner,
        body: {
          type: 'project_health',
          title: 'Saúde',
          config: { boardId },
          layout: { x: 0, y: 0, w: 12, h: 3 },
        },
      });
      const data = await api.get<{ data: WidgetDataEntry[] }>(`/v1/dashboards/${dashboard.body.id}/data`, {
        token: owner,
      });
      const entry = data.body.data.find((row) => row.widgetId === widget.body.id);
      expect(entry?.data).toMatchObject({ kind: 'project_health' });
      const latest = (entry?.data as { latest: { overall: string } | null }).latest;
      expect(latest).not.toBeNull();
    });
  });

  it('exclui widget e dashboard', async () => {
    const dashboard = await api.post<Dashboard>(`/v1/workspaces/${workspaceId}/dashboards`, {
      token: owner,
      body: { name: 'Painel descartável', sourceBoardIds: [boardId] },
    });
    const widget = await api.post<Widget>(`/v1/dashboards/${dashboard.body.id}/widgets`, {
      token: owner,
      body: {
        type: 'number',
        title: 'Temporário',
        config: { boardIds: [boardId], aggregate: 'count' },
        layout: { x: 0, y: 0, w: 3, h: 2 },
      },
    });
    expect((await api.delete(`/v1/widgets/${widget.body.id}`, { token: owner })).status).toBe(204);
    expect((await api.delete(`/v1/dashboards/${dashboard.body.id}`, { token: owner })).status).toBe(204);
    expect((await api.get(`/v1/dashboards/${dashboard.body.id}`, { token: owner })).status).toBe(404);
  });
});
