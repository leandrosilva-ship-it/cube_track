import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { client, demoIds, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface Automation {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  trigger: { type: string; config: Record<string, unknown> };
  actions: { type: string; config: Record<string, unknown> }[];
  isEnabled: boolean;
}

const ITEM_CREATED_TRIGGER = { type: 'item_created', config: {} };
const NOTIFY_ACTION = [{ type: 'notify', config: { message: 'Novo item: {item.name}' } }];

describe('Automações (ADR 0051)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let other: string;
  let workspaceId: string;
  let boardId: string;
  let groupId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    other = await api.login(USERS.thiago);
    const ids = await demoIds(api, owner);
    ({ workspaceId, boardId } = ids);
    groupId = ids.board.groups[0]?.id ?? '';
  });

  afterAll(async () => {
    await server.close();
  });

  it('cria, lista, atualiza, duplica e exclui uma automação de board', async () => {
    const created = await api.post<Automation>(`/v1/boards/${boardId}/automations`, {
      token: owner,
      body: {
        name: 'Notificar criação',
        trigger: ITEM_CREATED_TRIGGER,
        actions: NOTIFY_ACTION,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.boardId).toBe(boardId);
    expect(created.body.isEnabled).toBe(true);

    const list = await api.get<{ data: Automation[] }>(`/v1/boards/${boardId}/automations`, {
      token: owner,
    });
    expect(list.body.data.some((entry) => entry.id === created.body.id)).toBe(true);

    const updated = await api.patch<Automation>(`/v1/automations/${created.body.id}`, {
      token: owner,
      body: { isEnabled: false, name: 'Notificar criação (pausada)' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.isEnabled).toBe(false);
    expect(updated.body.name).toBe('Notificar criação (pausada)');

    const duplicated = await api.post<Automation>(
      `/v1/automations/${created.body.id}/duplicate`,
      { token: owner },
    );
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.isEnabled).toBe(false);
    expect(duplicated.body.name).toContain('cópia');

    const deleted = await api.delete(`/v1/automations/${created.body.id}`, { token: owner });
    expect(deleted.status).toBe(204);
    const afterDelete = await api.get<{ data: Automation[] }>(`/v1/boards/${boardId}/automations`, {
      token: owner,
    });
    expect(afterDelete.body.data.some((entry) => entry.id === created.body.id)).toBe(false);
  });

  it('rejeita gatilho e ações inválidas com 400', async () => {
    const badTrigger = await api.post(`/v1/boards/${boardId}/automations`, {
      token: owner,
      body: {
        name: 'Gatilho inválido',
        trigger: { type: 'column_value_changed', config: {} },
        actions: NOTIFY_ACTION,
      },
    });
    expect(badTrigger.status).toBe(400);

    const badActions = await api.post(`/v1/boards/${boardId}/automations`, {
      token: owner,
      body: {
        name: 'Ação inválida',
        trigger: ITEM_CREATED_TRIGGER,
        actions: [{ type: 'delete_board', config: {} }],
      },
    });
    expect(badActions.status).toBe(400);
  });

  it('exige `automation.manage` para gerenciar automações do board', async () => {
    const created = await api.post<Automation>(`/v1/boards/${boardId}/automations`, {
      token: owner,
      body: { name: 'Protegida', trigger: ITEM_CREATED_TRIGGER, actions: NOTIFY_ACTION },
    });
    expect(created.status).toBe(201);

    const listForbidden = await api.get(`/v1/boards/${boardId}/automations`, { token: other });
    expect(listForbidden.status).toBe(403);
    const updateForbidden = await api.patch(`/v1/automations/${created.body.id}`, {
      token: other,
      body: { isEnabled: false },
    });
    expect(updateForbidden.status).toBe(403);
  });

  it('CRUD de automação de workspace inteiro exige `workspace.manage`', async () => {
    const created = await api.post<Automation>(`/v1/workspaces/${workspaceId}/automations`, {
      token: owner,
      body: {
        name: 'Automação de workspace',
        trigger: ITEM_CREATED_TRIGGER,
        actions: NOTIFY_ACTION,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.boardId).toBeNull();
    expect(created.body.workspaceId).toBe(workspaceId);

    const list = await api.get<{ data: Automation[] }>(
      `/v1/workspaces/${workspaceId}/automations`,
      { token: owner },
    );
    expect(list.body.data.some((entry) => entry.id === created.body.id)).toBe(true);

    const forbidden = await api.get(`/v1/workspaces/${workspaceId}/automations`, { token: other });
    expect(forbidden.status).toBe(403);
  });

  it('clique num botão sem automação configurada falha com 422; com automação alinhada dispara', async () => {
    const withoutAutomation = await api.post<{ id: string; key: string }>(
      `/v1/boards/${boardId}/columns`,
      {
        token: owner,
        body: { type: 'button', title: 'Sem automação', settings: { label: 'Aprovar' } },
      },
    );
    expect(withoutAutomation.status).toBe(201);

    const item = await api.post<{ id: string }>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: { groupId, name: 'Item para clique de botão' },
    });
    expect(item.status).toBe(201);

    const clickWithoutAutomation = await api.post(
      `/v1/items/${item.body.id}/buttons/${withoutAutomation.body.key}`,
      { token: owner },
    );
    expect(clickWithoutAutomation.status).toBe(422);

    const column = await api.post<{ id: string; key: string }>(`/v1/boards/${boardId}/columns`, {
      token: owner,
      body: { type: 'button', title: 'Aprovar pedido', settings: { label: 'Aprovar' } },
    });
    expect(column.status).toBe(201);

    const automation = await api.post<Automation>(`/v1/boards/${boardId}/automations`, {
      token: owner,
      body: {
        name: 'Botão aprovar',
        trigger: { type: 'button_clicked', config: { columnKey: column.body.key } },
        actions: NOTIFY_ACTION,
      },
    });
    expect(automation.status).toBe(201);

    const mismatch = await api.post(
      `/v1/items/${item.body.id}/buttons/${column.body.key}`,
      { token: owner },
    );
    expect(mismatch.status).toBe(422); // settings.automationId ainda não aponta para a automação

    await api.patch(`/v1/boards/${boardId}/columns/${column.body.id}`, {
      token: owner,
      body: { settings: { label: 'Aprovar', automationId: automation.body.id } },
    });

    const click = await api.post(`/v1/items/${item.body.id}/buttons/${column.body.key}`, {
      token: owner,
    });
    expect(click.status).toBe(204);
  });
});
