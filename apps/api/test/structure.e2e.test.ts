import type { RealtimeEvent } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  waitFor,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

interface Tree {
  workspaceId: string;
  canManageFolders: boolean;
  canCreateBoards: boolean;
  folders: { id: string; parentId: string | null; name: string; position: string }[];
  boards: { id: string; folderId: string | null; name: string; position: string }[];
}

interface View {
  id: string;
  name: string;
  type: string;
  personal: boolean;
  isDefault: boolean;
  canEdit: boolean;
}

async function listen(url: string, token: string) {
  const socket: Socket = io(url, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  const events: RealtimeEvent[] = [];
  socket.on('event', (event: RealtimeEvent) => events.push(event));
  await new Promise<void>((resolve, reject) => {
    socket.once('ready', () => {
      resolve();
    });
    socket.once('connect_error', reject);
  });
  return { socket, events };
}

describe('Estrutura de navegação (workspaces, pastas, boards, favoritos, views)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let viewer: string;
  let guest: string;
  let workspaceId: string;
  let pmspBoardId: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    viewer = await api.login(USERS.thiago);
    guest = await api.login(USERS.patricia);
    const ids = await demoIds(api, owner);
    workspaceId = ids.workspaceId;
    pmspBoardId = ids.boardId;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await server.close();
  });

  const tree = async (token: string) =>
    (await api.get<Tree>(`/v1/workspaces/${workspaceId}/tree`, { token })).body;

  it('árvore filtrada por permissão: convidado vê só boards concedidos, sem pastas', async () => {
    const full = await tree(owner);
    expect(full.canManageFolders).toBe(true);
    expect(full.boards.map((board) => board.id)).toContain(pmspBoardId);

    const guestTree = await api.get<Tree>(`/v1/workspaces/${workspaceId}/tree`, { token: guest });
    expect(guestTree.status).toBe(200);
    expect(guestTree.body.folders).toEqual([]);
    expect(guestTree.body.canCreateBoards).toBe(false);
    expect(guestTree.body.boards.map((board) => board.id)).toEqual([pmspBoardId]);

    const workspaces = await api.get<{ data: { id: string }[] }>('/v1/workspaces', {
      token: guest,
    });
    expect(workspaces.body.data.map((workspace) => workspace.id)).toContain(workspaceId);
  });

  it('cria, renomeia, move e exclui pastas com auditoria e evento em tempo real', async () => {
    const listener = await listen(server.url, viewer);
    sockets.push(listener.socket);

    const parent = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/folders`, {
      token: owner,
      body: { name: 'Projetos 2027' },
    });
    expect(parent.status).toBe(201);
    const child = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/folders`, {
      token: owner,
      body: { name: 'Fase 1', parentId: parent.body.id },
    });
    expect(child.status).toBe(201);

    const event = await waitFor(() =>
      listener.events.find(
        (entry) =>
          entry.type === 'workspace.structure_changed' &&
          (entry.payload as { workspaceId: string }).workspaceId === workspaceId,
      ),
    );
    expect(event.actor.kind).toBe('user');

    const cycle = await api.patch(`/v1/folders/${parent.body.id}`, {
      token: owner,
      body: { parentId: child.body.id },
    });
    expect(cycle.status).toBe(400);

    const renamed = await api.patch(`/v1/folders/${child.body.id}`, {
      token: owner,
      body: { name: 'Fase 1 — Diagnóstico', parentId: null },
    });
    expect(renamed.status).toBe(200);
    const afterMove = await tree(owner);
    expect(afterMove.folders.find((folder) => folder.id === child.body.id)).toMatchObject({
      name: 'Fase 1 — Diagnóstico',
      parentId: null,
    });

    const forbidden = await api.post(`/v1/workspaces/${workspaceId}/folders`, {
      token: viewer,
      body: { name: 'Não pode' },
    });
    expect(forbidden.status).toBe(403);

    expect((await api.delete(`/v1/folders/${parent.body.id}`, { token: owner })).status).toBe(204);
    expect((await tree(owner)).folders.some((folder) => folder.id === parent.body.id)).toBe(false);

    const admin = adminDb();
    try {
      const audits = await admin.db.execute<{ action: string }>(
        sql`select action from audit_logs where entity_id = ${parent.body.id} order by created_at`,
      );
      expect(audits.rows.map((row) => row.action)).toEqual(['folder.create', 'folder.delete']);
    } finally {
      await admin.close();
    }
  });

  it('cria board com modelo inicial, dono explícito e reordena na árvore', async () => {
    const created = await api.post<{ id: string; folderId: string | null }>(
      `/v1/workspaces/${workspaceId}/boards`,
      { token: owner, body: { name: 'Board de Marketing', visibility: 'private' } },
    );
    expect(created.status).toBe(201);
    const boardId = created.body.id;

    const detail = await api.get<{
      groups: { name: string }[];
      columns: { key: string; title: string; labels: { label: string }[] }[];
      permissions: string[];
    }>(`/v1/boards/${boardId}`, { token: owner });
    expect(detail.body.groups.map((group) => group.name)).toEqual(['Novo grupo']);
    expect(detail.body.columns.map((column) => column.key)).toEqual([
      'c_status',
      'c_owner',
      'c_due',
    ]);
    expect(detail.body.columns[0]?.labels.map((label) => label.label)).toEqual([
      'A fazer',
      'Em andamento',
      'Parado',
      'Concluído',
    ]);
    expect(detail.body.permissions).toContain('board.manage');

    // Board privado: o leitor do workspace não o enxerga.
    expect((await tree(viewer)).boards.some((board) => board.id === boardId)).toBe(false);
    expect((await api.get(`/v1/boards/${boardId}`, { token: viewer })).status).toBe(404);

    const views = await api.get<{ data: View[] }>(`/v1/boards/${boardId}/views`, { token: owner });
    expect(views.body.data).toMatchObject([
      { name: 'Tabela principal', type: 'table', isDefault: true },
    ]);

    const outside = await api.patch(`/v1/boards/${boardId}`, {
      token: owner,
      body: { folderId: null, beforeId: pmspBoardId },
    });
    const pmspFolder = (await tree(owner)).boards.find(
      (board) => board.id === pmspBoardId,
    )?.folderId;
    if (pmspFolder !== null && pmspFolder !== undefined) expect(outside.status).toBe(400);

    const moved = await api.patch(`/v1/boards/${boardId}`, {
      token: owner,
      body: { folderId: pmspFolder ?? null, beforeId: pmspBoardId },
    });
    expect(moved.status).toBe(200);
    const ordered = (await tree(owner)).boards.filter(
      (board) => board.folderId === (pmspFolder ?? null),
    );
    const index = ordered.findIndex((board) => board.id === boardId);
    expect(ordered[index + 1]?.id).toBe(pmspBoardId);

    const renamed = await api.patch(`/v1/boards/${boardId}`, {
      token: owner,
      body: { name: 'Marketing 2027', description: 'Campanhas' },
    });
    expect(renamed.status).toBe(200);
    expect(
      (await api.patch(`/v1/boards/${pmspBoardId}`, { token: viewer, body: { name: 'x' } })).status,
    ).toBe(403);
  });

  it('favoritos: adiciona (idempotente), lista resolvido e remove', async () => {
    const add = () =>
      api.put('/v1/me/favorites', {
        token: viewer,
        body: { entityType: 'board', entityId: pmspBoardId },
      });
    expect((await add()).status).toBe(200);
    expect((await add()).status).toBe(200);
    const list = await api.get<{ data: { entityId: string; name: string }[] }>('/v1/me/favorites', {
      token: viewer,
    });
    expect(list.body.data.filter((entry) => entry.entityId === pmspBoardId)).toHaveLength(1);
    expect(list.body.data.find((entry) => entry.entityId === pmspBoardId)?.name).toBe('PMSP');

    const hidden = await api.put('/v1/me/favorites', {
      token: guest,
      body: { entityType: 'workspace', entityId: workspaceId },
    });
    expect(hidden.status).toBe(404);

    expect(
      (await api.delete(`/v1/me/favorites/board/${pmspBoardId}`, { token: viewer })).status,
    ).toBe(204);
    const after = await api.get<{ data: { entityId: string }[] }>('/v1/me/favorites', {
      token: viewer,
    });
    expect(after.body.data.some((entry) => entry.entityId === pmspBoardId)).toBe(false);
  });

  it('views: pessoal só para o dono, compartilhada exige view.manage, padrão não é excluída', async () => {
    const personal = await api.post<View>(`/v1/boards/${pmspBoardId}/views`, {
      token: viewer,
      body: { name: 'Minhas pendências', type: 'kanban', personal: true },
    });
    expect(personal.status).toBe(201);
    expect(personal.body.personal).toBe(true);

    const sharedByViewer = await api.post(`/v1/boards/${pmspBoardId}/views`, {
      token: viewer,
      body: { name: 'Compartilhada', type: 'table' },
    });
    expect(sharedByViewer.status).toBe(403);

    const ownerViews = await api.get<{ data: View[] }>(`/v1/boards/${pmspBoardId}/views`, {
      token: owner,
    });
    expect(ownerViews.body.data.some((view) => view.id === personal.body.id)).toBe(false);
    const viewerViews = await api.get<{ data: View[] }>(`/v1/boards/${pmspBoardId}/views`, {
      token: viewer,
    });
    expect(viewerViews.body.data.find((view) => view.id === personal.body.id)?.canEdit).toBe(true);

    const defaultView = ownerViews.body.data.find((view) => view.isDefault);
    expect((await api.delete(`/v1/views/${defaultView?.id ?? ''}`, { token: owner })).status).toBe(
      400,
    );
    expect((await api.delete(`/v1/views/${personal.body.id}`, { token: viewer })).status).toBe(204);
  });

  it('inbox: lista notificações do próprio usuário e marca como lidas', async () => {
    const admin = adminDb();
    try {
      await admin.db.execute(sql`
        insert into notifications (tenant_id, user_id, type, title)
        select m.tenant_id, u.id, 'mention', 'Teste de inbox'
        from users u join memberships m on m.user_id = u.id
        where u.email = ${USERS.thiago}`);
    } finally {
      await admin.close();
    }
    const page = await api.get<{
      data: { id: string; title: string; readAt: string | null }[];
      unreadCount: number;
    }>('/v1/me/notifications?unreadOnly=true', { token: viewer });
    expect(page.status).toBe(200);
    expect(page.body.data.some((entry) => entry.title === 'Teste de inbox')).toBe(true);
    expect(page.body.unreadCount).toBeGreaterThan(0);

    const read = await api.post<{ updated: number }>('/v1/me/notifications/read', {
      token: viewer,
      body: {},
    });
    expect(read.body.updated).toBe(page.body.unreadCount);
    const after = await api.get<{ unreadCount: number }>('/v1/me/notifications', {
      token: viewer,
    });
    expect(after.body.unreadCount).toBe(0);

    const ownerPage = await api.get<{ data: { title: string }[] }>('/v1/me/notifications', {
      token: owner,
    });
    expect(ownerPage.body.data.some((entry) => entry.title === 'Teste de inbox')).toBe(false);
  });

  it('minha semana: itens atribuídos com prazo na semana', async () => {
    const week = await api.get<{
      from: string;
      to: string;
      data: { id: string; dueDate: string; overdue: boolean }[];
    }>('/v1/me/week?date=2026-10-14', { token: owner });
    expect(week.status).toBe(200);
    expect(week.body.from).toBe('2026-10-12');
    expect(week.body.to).toBe('2026-10-18');
    for (const entry of week.body.data) {
      expect(entry.dueDate <= week.body.to).toBe(true);
      if (!entry.overdue) expect(entry.dueDate >= week.body.from).toBe(true);
    }
  });
});
