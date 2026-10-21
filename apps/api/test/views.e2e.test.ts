import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  client,
  demoIds,
  requiredValues,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
  type BoardDetailFixture,
} from './helpers.js';

interface View {
  id: string;
  boardId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  filters: Record<string, unknown> | null;
  sort: { columnKey: string; direction: string }[];
  groupBy: { levels: string[] } | null;
  hiddenColumnKeys: string[];
  isDefault: boolean;
  isLocked: boolean;
  isRestricted: boolean;
  personal: boolean;
  canEdit: boolean;
}

interface ShareLinkStatus {
  exists: boolean;
  requiresPassword?: boolean;
  expiresAt?: string | null;
  settings?: { hiddenColumnKeys: string[]; allowSearch: boolean };
}

interface ShareLinkResult {
  token: string | null;
  path: string;
  requiresPassword: boolean;
  settings: { hiddenColumnKeys: string[]; allowSearch: boolean };
}

interface Item {
  id: string;
  groupId: string;
  values: Record<string, Record<string, unknown>>;
}

type Board = BoardDetailFixture & { id: string };

describe('Views: registro, governança, link público e filtros salvos (Prompt 6)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let viewer: string;
  let boardId: string;
  let board: Board;

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    viewer = await api.login(USERS.thiago);
    const ids = await demoIds(api, owner);
    boardId = ids.boardId;
    board = { ...ids.board, id: boardId };
  });

  afterAll(async () => {
    await server.close();
  });

  const column = (key: string) => {
    const found = board.columns.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(`coluna ${key}`);
    return found;
  };
  const labelId = (key: string, label: string) => {
    const found = column(key).labels.find((entry) => entry.label === label);
    if (found === undefined) throw new Error(`rótulo ${label} em ${key}`);
    return found.id;
  };

  it('cria view Kanban por Frente com swimlanes por grupo, filtros, ordenação e agrupamento', async () => {
    const created = await api.post<View>(`/v1/boards/${boardId}/views`, {
      token: owner,
      body: {
        name: 'Kanban por Frente',
        type: 'kanban',
        config: { columnsBy: 'c_frente', swimlanesBy: 'group', cardFields: ['c_status'] },
        filters: { op: 'and', conditions: [{ field: 'c_status', operator: 'is_empty' }] },
        sort: [{ columnKey: 'c_termino_planejado', direction: 'asc' }],
        groupBy: { levels: ['group'] },
        hiddenColumnKeys: ['c_faturamento'],
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.config).toMatchObject({ columnsBy: 'c_frente', swimlanesBy: 'group' });
    expect(created.body.filters).toMatchObject({ op: 'and' });
    expect(created.body.sort).toEqual([{ columnKey: 'c_termino_planejado', direction: 'asc' }]);
    expect(created.body.groupBy).toEqual({ levels: ['group'] });
    expect(created.body.hiddenColumnKeys).toEqual(['c_faturamento']);

    // Config inválida para o tipo (chave desconhecida do Kanban) é rejeitada.
    const invalid = await api.post(`/v1/boards/${boardId}/views`, {
      token: owner,
      body: { name: 'Inválida', type: 'kanban', config: { naoExiste: true } },
    });
    expect(invalid.status).toBe(400);
  });

  it('atualiza config/filtros de uma view e governança (padrão/bloqueio/restrição exigem view.manage)', async () => {
    const created = await api.post<View>(`/v1/boards/${boardId}/views`, {
      token: owner,
      body: { name: 'Compartilhada para governança', type: 'table' },
    });
    expect(created.status).toBe(201);

    // Viewer lê a view compartilhada (board.read), mas não gerencia governança (sem view.manage).
    const asViewer = await api.patch(`/v1/views/${created.body.id}`, {
      token: viewer,
      body: { isDefault: true },
    });
    expect(asViewer.status).toBe(403);

    const update = await api.patch<{ id: string; changes: Record<string, unknown> }>(
      `/v1/views/${created.body.id}`,
      { token: owner, body: { hiddenColumnKeys: ['c_ust'] } },
    );
    expect(update.status).toBe(200);
    expect(update.body.changes.hiddenColumnKeys).toEqual(['c_ust']);
  });

  it('tornar uma view padrão troca o antigo default do board sem violar a constraint única', async () => {
    const listBefore = await api.get<{ data: View[] }>(`/v1/boards/${boardId}/views`, {
      token: owner,
    });
    const oldDefault = listBefore.body.data.find((view) => view.isDefault);
    expect(oldDefault).toBeDefined();

    const created = await api.post<View>(`/v1/boards/${boardId}/views`, {
      token: owner,
      body: { name: 'Futura padrão', type: 'table' },
    });
    expect(created.status).toBe(201);

    const update = await api.patch<{ id: string; changes: Record<string, unknown> }>(
      `/v1/views/${created.body.id}`,
      { token: owner, body: { isDefault: true } },
    );
    expect(update.status, JSON.stringify(update.body)).toBe(200);
    expect(update.body.changes.isDefault).toBe(true);

    const listAfter = await api.get<{ data: View[] }>(`/v1/boards/${boardId}/views`, {
      token: owner,
    });
    const defaults = listAfter.body.data.filter((view) => view.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(created.body.id);
    const previous = listAfter.body.data.find((view) => view.id === oldDefault?.id);
    expect(previous?.isDefault).toBe(false);
  });

  it('duplica uma view: a cópia é independente da original', async () => {
    const original = await api.post<View>(`/v1/boards/${boardId}/views`, {
      token: owner,
      body: { name: 'Original', type: 'table', hiddenColumnKeys: ['c_ust'] },
    });
    expect(original.status).toBe(201);

    const copy = await api.post<View>(`/v1/views/${original.body.id}/duplicate`, {
      token: owner,
      body: {},
    });
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body.id).not.toBe(original.body.id);
    expect(copy.body.name).toBe('Original (cópia)');
    expect(copy.body.hiddenColumnKeys).toEqual(['c_ust']);

    await api.patch(`/v1/views/${copy.body.id}`, {
      token: owner,
      body: { hiddenColumnKeys: ['c_faturamento'] },
    });
    const originalAfter = await api.get<{ data: View[] }>(`/v1/boards/${boardId}/views`, {
      token: owner,
    });
    expect(
      originalAfter.body.data.find((view) => view.id === original.body.id)?.hiddenColumnKeys,
    ).toEqual(['c_ust']);
  });

  it('link público: criar, verificar senha, ler board/itens com colunas ocultas redigidas', async () => {
    const view = await api.post<View>(`/v1/boards/${boardId}/views`, {
      token: owner,
      body: { name: 'Pública', type: 'table' },
    });
    expect(view.status).toBe(201);

    const deniedStatus = await api.get(`/v1/views/${view.body.id}/share-link`, { token: viewer });
    expect(deniedStatus.status).toBe(403);

    const emptyStatus = await api.get<ShareLinkStatus>(`/v1/views/${view.body.id}/share-link`, {
      token: owner,
    });
    expect(emptyStatus.body.exists).toBe(false);

    const upsert = await api.put<ShareLinkResult>(`/v1/views/${view.body.id}/share-link`, {
      token: owner,
      body: { password: 'segredo123', hiddenColumnKeys: ['c_ust'], allowSearch: true },
    });
    expect(upsert.status, JSON.stringify(upsert.body)).toBe(200);
    expect(upsert.body.token).not.toBeNull();
    expect(upsert.body.requiresPassword).toBe(true);
    const token = upsert.body.token ?? '';

    const status = await api.get<ShareLinkStatus>(`/v1/views/${view.body.id}/share-link`, {
      token: owner,
    });
    expect(status.body.exists).toBe(true);
    expect(status.body.requiresPassword).toBe(true);

    const info = await api.get<{ requiresPassword: boolean }>(`/v1/public/share/${token}/info`);
    expect(info.body.requiresPassword).toBe(true);

    const wrongPassword = await api.post(`/v1/public/share/${token}/verify`, {
      body: { password: 'errada' },
    });
    expect(wrongPassword.status).toBe(401);

    const verified = await api.post<{ shareToken: string; boardId: string; viewId: string }>(
      `/v1/public/share/${token}/verify`,
      { body: { password: 'segredo123' } },
    );
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(verified.body.boardId).toBe(boardId);
    const session = verified.body.shareToken;

    const noSession = await api.get('/v1/public/share/board');
    expect(noSession.status).toBe(401);

    const publicBoard = await api.get<{ columns: { key: string }[] }>('/v1/public/share/board', {
      headers: { 'x-share-session': session },
    });
    expect(publicBoard.status, JSON.stringify(publicBoard.body)).toBe(200);
    expect(publicBoard.body.columns.some((entry) => entry.key === 'c_ust')).toBe(false);

    const publicItems = await api.get<{ data: { values: Record<string, unknown> }[] }>(
      '/v1/public/share/items',
      { headers: { 'x-share-session': session } },
    );
    expect(publicItems.status).toBe(200);
    expect(publicItems.body.data.every((item) => !('c_ust' in item.values))).toBe(true);

    // Regenerar o token invalida o anterior.
    const regenerated = await api.put<ShareLinkResult>(`/v1/views/${view.body.id}/share-link`, {
      token: owner,
      body: { regenerateToken: true },
    });
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.token).not.toBe(token);
    expect((await api.get(`/v1/public/share/${token}/info`)).status).toBe(401);

    await api.delete(`/v1/views/${view.body.id}/share-link`, { token: owner });
    expect((await api.get(`/v1/public/share/${regenerated.body.token ?? ''}/info`)).status).toBe(
      401,
    );
  });

  it('filtros salvos: pessoal só para o dono, compartilhado exige view.manage', async () => {
    const personal = await api.post(`/v1/boards/${boardId}/saved-filters`, {
      token: viewer,
      body: {
        name: 'Meus pendentes',
        filter: { op: 'and', conditions: [{ field: 'c_status', operator: 'is_empty' }] },
      },
    });
    expect(personal.status, JSON.stringify(personal.body)).toBe(201);

    const sharedDenied = await api.post(`/v1/boards/${boardId}/saved-filters`, {
      token: viewer,
      body: {
        name: 'Compartilhado',
        filter: { op: 'and', conditions: [] },
        isShared: true,
      },
    });
    expect(sharedDenied.status).toBe(403);

    const list = await api.get<{ data: { id: string; mine: boolean }[] }>(
      `/v1/boards/${boardId}/saved-filters`,
      { token: owner },
    );
    expect(list.body.data.some((entry) => entry.mine)).toBe(false);
  });

  it('transição de status: bloqueia pulo de etapa quando configurada, permite o resto', async () => {
    const naoIniciado = labelId('c_status', 'Não iniciado');
    const emAndamento = labelId('c_status', 'Em andamento');
    const concluido = labelId('c_status', 'Concluído');

    const configured = await api.patch(`/v1/boards/${boardId}/columns/${column('c_status').id}`, {
      token: owner,
      body: { settings: { transitions: { [naoIniciado]: [emAndamento] } } },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);

    const item = await api.post<Item>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: {
        groupId: board.groups[0]?.id ?? '',
        name: 'Transição de status',
        values: { ...requiredValues(board), c_status: { labelId: naoIniciado } },
      },
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);

    const skip = await api.patch(`/v1/items/${item.body.id}`, {
      token: owner,
      body: { values: { c_status: { labelId: concluido } } },
    });
    expect(skip.status).toBe(422);
    expect(skip.body).toMatchObject({ code: 'invalid_transition' });

    const allowed = await api.patch(`/v1/items/${item.body.id}`, {
      token: owner,
      body: { values: { c_status: { labelId: emAndamento } } },
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);

    // "Em andamento" não tem regra configurada: segue livre ("Término Realizado" é exigido só
    // porque o Status final é "Concluído" — obrigatoriedade condicional do Prompt 5).
    const free = await api.patch(`/v1/items/${item.body.id}`, {
      token: owner,
      body: {
        values: { c_status: { labelId: concluido } },
        fields: { actualEndDate: '2026-03-01' },
      },
    });
    expect(free.status, JSON.stringify(free.body)).toBe(200);

    // Limpa a regra para não afetar outros testes que reusam este board.
    await api.patch(`/v1/boards/${boardId}/columns/${column('c_status').id}`, {
      token: owner,
      body: { settings: { transitions: {} } },
    });
  });
});
