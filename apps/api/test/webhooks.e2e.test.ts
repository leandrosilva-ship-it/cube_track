import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client, demoIds, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface Webhook {
  id: string;
  workspaceId: string | null;
  boardId: string | null;
  name: string;
  url: string;
  events: string[];
  isEnabled: boolean;
}
interface WebhookWithSecret extends Webhook {
  secret: string;
}

describe('Webhooks de saída (ADR 0051)', () => {
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

  it('cria um webhook de board, devolve o segredo só na criação, lista, atualiza e exclui', async () => {
    const created = await api.post<WebhookWithSecret>(`/v1/boards/${boardId}/webhooks`, {
      token: owner,
      body: {
        name: 'Integração externa',
        url: 'https://example.com/hooks/cube-track',
        events: ['item.created', 'item.updated'],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.secret).toBeTruthy();
    expect(created.body.boardId).toBe(boardId);

    const list = await api.get<{ data: Webhook[] }>(`/v1/boards/${boardId}/webhooks`, {
      token: owner,
    });
    const listed = list.body.data.find((entry) => entry.id === created.body.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('secret');

    const updated = await api.patch<Webhook>(`/v1/webhooks/${created.body.id}`, {
      token: owner,
      body: { isEnabled: false },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.isEnabled).toBe(false);

    const regenerated = await api.post<WebhookWithSecret>(
      `/v1/webhooks/${created.body.id}/regenerate-secret`,
      { token: owner },
    );
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.secret).toBeTruthy();
    expect(regenerated.body.secret).not.toBe(created.body.secret);

    const removed = await api.delete(`/v1/webhooks/${created.body.id}`, { token: owner });
    expect(removed.status).toBe(204);
    const afterDelete = await api.get<{ data: Webhook[] }>(`/v1/boards/${boardId}/webhooks`, {
      token: owner,
    });
    expect(afterDelete.body.data.some((entry) => entry.id === created.body.id)).toBe(false);
  });

  it('rejeita URL não-https e lista de eventos vazia ou desconhecida', async () => {
    const insecure = await api.post(`/v1/boards/${boardId}/webhooks`, {
      token: owner,
      body: { name: 'Inseguro', url: 'http://example.com', events: ['item.created'] },
    });
    expect(insecure.status).toBe(400);

    const empty = await api.post(`/v1/boards/${boardId}/webhooks`, {
      token: owner,
      body: { name: 'Sem eventos', url: 'https://example.com', events: [] },
    });
    expect(empty.status).toBe(400);

    const unknown = await api.post(`/v1/boards/${boardId}/webhooks`, {
      token: owner,
      body: { name: 'Evento inválido', url: 'https://example.com', events: ['not.a.real.event'] },
    });
    expect(unknown.status).toBe(400);
  });

  it('exige `webhook.manage` no board (CRUD) e `workspace.manage` para webhooks de workspace inteiro', async () => {
    const forbidden = await api.post(`/v1/boards/${boardId}/webhooks`, {
      token: other,
      body: { name: 'Sem permissão', url: 'https://example.com', events: ['item.created'] },
    });
    expect(forbidden.status).toBe(403);

    const workspaceScoped = await api.post<WebhookWithSecret>(
      `/v1/workspaces/${workspaceId}/webhooks`,
      {
        token: owner,
        body: {
          name: 'Webhook de workspace',
          url: 'https://example.com/workspace',
          events: ['board.updated'],
        },
      },
    );
    expect(workspaceScoped.status).toBe(201);
    expect(workspaceScoped.body.boardId).toBeNull();
    expect(workspaceScoped.body.workspaceId).toBe(workspaceId);

    const forbiddenWorkspace = await api.get(`/v1/workspaces/${workspaceId}/webhooks`, {
      token: other,
    });
    expect(forbiddenWorkspace.status).toBe(403);

    await api.delete(`/v1/webhooks/${workspaceScoped.body.id}`, { token: owner });
  });
});
