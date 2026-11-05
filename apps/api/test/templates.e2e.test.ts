import { schema } from '@cube-track/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDb, client, demoIds, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface Template {
  id: string;
  tenantId: string | null;
  kind: string;
  name: string;
  category: string | null;
  payload: Record<string, unknown>;
  usageCount: number;
  isGlobal: boolean;
}

const BOARD_PAYLOAD = {
  name: 'Template de teste',
  description: 'Board de teste criado via template.',
  icon: 'layout-grid',
  groups: [
    { name: 'A fazer', color: '#579bfc' },
    { name: 'Feito', color: '#00c875' },
  ],
  columns: [
    {
      key: 'c_status',
      type: 'status',
      title: 'Status',
      width: 140,
      labels: [
        { label: 'A fazer', color: '#c4c4c4', category: 'not_started' },
        { label: 'Concluído', color: '#00c875', category: 'done' },
      ],
    },
    { key: 'c_owner', type: 'people', title: 'Responsável', width: 150 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Tabela principal',
};

describe('Galeria de templates (ADR 0056)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string; // ana (owner — tem templates.manage)
  let member: string; // thiago (viewer — sem templates.manage)
  let workspaceId: string;
  let boardId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    member = await api.login(USERS.thiago);
    ({ workspaceId, boardId } = await demoIds(api, owner));
  });

  afterAll(async () => {
    await server.close();
  });

  it('`scope=public` lista a galeria global semeada (board-templates.ts + os 7 novos) sem permissão extra', async () => {
    const list = await api.get<{ data: Template[] }>('/v1/templates?scope=public', { token: member });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(11);
    expect(list.body.data.every((entry) => entry.isGlobal)).toBe(true);
    expect(list.body.data.some((entry) => entry.name === 'Scrum')).toBe(true);
    expect(list.body.data.some((entry) => entry.name === 'Gestão de contratos UST')).toBe(true);
    expect(list.body.data.some((entry) => entry.kind === 'workspace' && entry.name === 'PMO')).toBe(true);
  });

  it('CRUD da galeria interna exige `templates.manage`; leitura é livre para qualquer membro', async () => {
    const forbidden = await api.post('/v1/templates', {
      token: member,
      body: { kind: 'board', name: 'Sem permissão', payload: BOARD_PAYLOAD },
    });
    expect(forbidden.status).toBe(403);

    const created = await api.post<Template>('/v1/templates', {
      token: owner,
      body: { kind: 'board', name: 'Template do tenant', category: 'Teste', payload: BOARD_PAYLOAD },
    });
    expect(created.status).toBe(201);
    expect(created.body.isGlobal).toBe(false);

    const readByMember = await api.get<{ data: Template[] }>('/v1/templates', { token: member });
    expect(readByMember.status).toBe(200);
    expect(readByMember.body.data.some((entry) => entry.id === created.body.id)).toBe(true);

    const forbiddenUpdate = await api.patch(`/v1/templates/${created.body.id}`, {
      token: member,
      body: { name: 'Tentativa sem permissão' },
    });
    expect(forbiddenUpdate.status).toBe(403);

    const updated = await api.patch<Template>(`/v1/templates/${created.body.id}`, {
      token: owner,
      body: { name: 'Template do tenant (renomeado)' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Template do tenant (renomeado)');

    const forbiddenDelete = await api.delete(`/v1/templates/${created.body.id}`, { token: member });
    expect(forbiddenDelete.status).toBe(403);
    const removed = await api.delete(`/v1/templates/${created.body.id}`, { token: owner });
    expect(removed.status).toBe(204);
  });

  it('payload inválido para o `kind` é rejeitado (422)', async () => {
    const invalid = await api.post('/v1/templates', {
      token: owner,
      body: { kind: 'board', name: 'Payload ruim', payload: { nome: 'sem os campos certos' } },
    });
    expect(invalid.status).toBe(422);
  });

  it('um template global (`tenantId` nulo) nunca pode ser editado/excluído pelos endpoints do tenant', async () => {
    const list = await api.get<{ data: Template[] }>('/v1/templates?scope=public&kind=board', { token: owner });
    const scrum = list.body.data.find((entry) => entry.name === 'Scrum');
    expect(scrum).toBeDefined();
    const patch = await api.patch(`/v1/templates/${scrum?.id}`, { token: owner, body: { name: 'Hackeado' } });
    expect(patch.status).toBe(404);
    const del = await api.delete(`/v1/templates/${scrum?.id}`, { token: owner });
    expect(del.status).toBe(404);
    // Continua legível por qualquer um (não foi afetado).
    const stillThere = await api.get(`/v1/templates/${scrum?.id}`, { token: member });
    expect(stillThere.status).toBe(200);
  });

  it('aplicar um template `board` cria um board de verdade com os grupos/colunas certos', async () => {
    const created = await api.post<Template>('/v1/templates', {
      token: owner,
      body: { kind: 'board', name: 'Template para aplicar', payload: BOARD_PAYLOAD },
    });
    const applied = await api.post<{ kind: string; created: { boardId: string; workspaceId: string } }>(
      `/v1/templates/${created.body.id}/apply`,
      { token: owner, body: { workspaceId, name: 'Board aplicado do template' } },
    );
    expect(applied.status).toBe(201);
    expect(applied.body.kind).toBe('board');
    const newBoardId = applied.body.created.boardId;

    const boardDetail = await api.get<{
      groups: { name: string }[];
      columns: { key: string; type: string; title: string }[];
    }>(`/v1/boards/${newBoardId}`, { token: owner });
    expect(boardDetail.body.groups.map((g) => g.name).sort()).toEqual(['A fazer', 'Feito'].sort());
    expect(boardDetail.body.columns.some((c) => c.key === 'c_status' && c.type === 'status')).toBe(true);
    expect(boardDetail.body.columns.some((c) => c.key === 'c_owner' && c.type === 'people')).toBe(true);

    const usage = await api.get<Template>(`/v1/templates/${created.body.id}`, { token: owner });
    expect(usage.body.usageCount).toBeGreaterThanOrEqual(1);
  });

  it('aplicar exige a permissão do recurso-alvo (ex.: `board.create` no workspace de destino)', async () => {
    const created = await api.post<Template>('/v1/templates', {
      token: owner,
      body: { kind: 'board', name: 'Template restrito', payload: BOARD_PAYLOAD },
    });
    const forbidden = await api.post(`/v1/templates/${created.body.id}/apply`, {
      token: member,
      body: { workspaceId },
    });
    expect(forbidden.status).toBe(403);
  });

  it('salvar o board atual como template e aplicá-lo de novo produz um board equivalente', async () => {
    const saved = await api.post<Template>(`/v1/boards/${boardId}/save-as-template`, {
      token: owner,
      body: { name: 'PMSP salvo como template', includeItems: false },
    });
    expect(saved.status).toBe(201);
    expect(saved.body.kind).toBe('board');
    const payload = saved.body.payload as { groups: { name: string }[]; columns: { key: string }[] };
    expect(payload.groups.length).toBeGreaterThan(0);
    expect(payload.columns.length).toBeGreaterThan(0);

    const applied = await api.post<{ created: { boardId: string } }>(`/v1/templates/${saved.body.id}/apply`, {
      token: owner,
      body: { workspaceId, name: 'PMSP reconstruído' },
    });
    expect(applied.status).toBe(201);
    const rebuilt = await api.get<{ groups: { name: string }[]; columns: { key: string }[] }>(
      `/v1/boards/${applied.body.created.boardId}`,
      { token: owner },
    );
    expect(rebuilt.body.groups.map((g) => g.name).sort()).toEqual(payload.groups.map((g) => g.name).sort());
    expect(rebuilt.body.columns.map((c) => c.key).sort()).toEqual(payload.columns.map((c) => c.key).sort());
  });

  it('semeadura da galeria pública é idempotente (`seedPublicTemplates` não duplica)', async () => {
    const db = adminDb();
    try {
      const { seedPublicTemplates } = await import('@cube-track/db');
      const result = await seedPublicTemplates(db.db);
      expect(result.created).toBe(false);
      const rows = await db.db.select().from(schema.templates);
      const globalCount = rows.filter((row) => row.tenantId === null).length;
      expect(globalCount).toBeGreaterThanOrEqual(11);
    } finally {
      await db.close();
    }
  });
});
