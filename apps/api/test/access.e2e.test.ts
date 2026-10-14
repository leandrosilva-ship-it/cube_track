import { request as httpRequest } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from 'drizzle-orm';

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

interface Item {
  id: string;
  name: string;
  values: Record<string, unknown>;
  plannedEndDate: string | null;
  redactedFields: string[];
}
interface Page {
  data: Item[];
}

describe('Isolamento entre tenants e RBAC em 5 níveis', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string;
  let manager: string;
  let editor: string;
  let viewer: string;
  let guest: string;
  let boardId: string;
  let columns: Record<string, { id: string; labels: { id: string; label: string }[] }>;
  let itemId: string;
  let otherItemId: string;
  let userIds: Record<string, string>;

  const setColumnPermissions = (key: string, permissions: Record<string, unknown>) =>
    api.patch(`/v1/boards/${boardId}/columns/${columns[key]?.id ?? ''}`, {
      token: owner,
      body: { permissions },
    });

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    manager = await api.login(USERS.fernanda);
    editor = await api.login(USERS.juliana);
    viewer = await api.login(USERS.thiago);
    guest = await api.login(USERS.patricia);
    const ids = await demoIds(api, owner);
    boardId = ids.boardId;
    columns = Object.fromEntries(ids.board.columns.map((column) => [column.key, column]));
    const items = await api.get<Page>(`/v1/boards/${boardId}/items?limit=2&sort=name:asc`, {
      token: owner,
    });
    itemId = items.body.data[0]?.id ?? '';
    otherItemId = items.body.data[1]?.id ?? '';
    const members = await api.get<{ data: { userId: string; email: string }[] }>('/v1/members', {
      token: owner,
    });
    userIds = Object.fromEntries(members.body.data.map((member) => [member.email, member.userId]));
  });

  afterAll(async () => {
    for (const key of ['c_tipo', 'c_status', 'c_termino_planejado'])
      await setColumnPermissions(key, {});
    await server.close();
  });

  describe('tenants', () => {
    let foreign: string;

    beforeAll(async () => {
      const signup = await api.post<{ accessToken: string }>('/v1/auth/signup', {
        body: {
          name: 'Dona Externa',
          email: 'dona.externa@exemplo.com',
          password: 'Senha-Segura-2026',
          organizationName: 'Externa',
          organizationSlug: 'externa',
        },
      });
      foreign = signup.body.accessToken;
    });

    it('usuário de outro tenant não acessa board, itens nem GraphQL (404)', async () => {
      expect((await api.get(`/v1/boards/${boardId}`, { token: foreign })).status).toBe(404);
      expect((await api.get(`/v1/boards/${boardId}/items`, { token: foreign })).status).toBe(404);
      expect((await api.get(`/v1/items/${itemId}`, { token: foreign })).status).toBe(404);
      expect(
        (await api.patch(`/v1/items/${itemId}`, { token: foreign, body: { name: 'invadido' } }))
          .status,
      ).toBe(404);
      expect((await api.delete(`/v1/items/${itemId}`, { token: foreign })).status).toBe(404);
      const graphql = await api.graphql(
        'query($id: ID!) { item(id: $id) { id name } }',
        { id: itemId },
        foreign,
      );
      expect(graphql.body.errors?.[0]?.extensions?.code).toBe('not_found');
      const workspaces = await api.get<{ data: unknown[] }>('/v1/workspaces', { token: foreign });
      expect(workspaces.body.data).toHaveLength(1);
    });

    it('o tenant do token deve coincidir com o do subdomínio/header', async () => {
      const mismatch = await api.get<{ code: string }>('/v1/me', {
        token: foreign,
        headers: { 'x-tenant': 'empresa-demo' },
      });
      expect(mismatch.status).toBe(403);
      expect(mismatch.body.code).toBe('tenant_mismatch');
      // fetch não permite sobrescrever o Host; usa node:http para simular subdomínios.
      const withHost = (host: string, token: string) =>
        new Promise<{ status: number; body: { code?: string } }>((resolve, reject) => {
          const url = new URL(`${server.url}/v1/me`);
          const request = httpRequest(
            {
              hostname: url.hostname,
              port: url.port,
              path: url.pathname,
              headers: { host, authorization: `Bearer ${token}` },
            },
            (response) => {
              let raw = '';
              response.on('data', (chunk: Buffer) => (raw += chunk.toString()));
              response.on('end', () => {
                resolve({
                  status: response.statusCode ?? 0,
                  body: JSON.parse(raw) as { code?: string },
                });
              });
            },
          );
          request.on('error', reject);
          request.end();
        });
      expect((await withHost('empresa-demo.cubetrack.test', owner)).status).toBe(200);
      const crossed = await withHost('externa.cubetrack.test', owner);
      expect(crossed.status).toBe(403);
      expect(crossed.body.code).toBe('tenant_mismatch');
      const unknown = await withHost('inexistente.cubetrack.test', owner);
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('tenant_not_found');
    });
  });

  describe('coluna', () => {
    beforeAll(async () => {
      expect(
        (
          await setColumnPermissions('c_tipo', {
            viewers: { userIds: [userIds[USERS.ana], userIds[USERS.carlos]] },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await setColumnPermissions('c_termino_planejado', {
            viewers: { userIds: [userIds[USERS.ana]] },
          })
        ).status,
      ).toBe(200);
      expect(
        (await setColumnPermissions('c_status', { editors: { userIds: [userIds[USERS.carlos]] } }))
          .status,
      ).toBe(200);
    });

    it('REST omite valores de colunas sem permissão de leitura (inclusive campos vinculados)', async () => {
      const list = await api.get<Page>(`/v1/boards/${boardId}/items?limit=50`, { token: editor });
      expect(list.status).toBe(200);
      expect(list.body.data.every((item) => !('c_tipo' in item.values))).toBe(true);
      expect(list.body.data.every((item) => item.plannedEndDate === null)).toBe(true);
      const single = await api.get<Item>(`/v1/items/${itemId}`, { token: editor });
      expect(single.body.values).not.toHaveProperty('c_tipo');
      expect(single.body.redactedFields).toContain('plannedEndDate');
      const board = await api.get<{ columns: { key: string }[] }>(`/v1/boards/${boardId}`, {
        token: editor,
      });
      expect(board.body.columns.map((column) => column.key)).not.toContain('c_tipo');
      const permissions = await api.get<{ hiddenColumnKeys: string[] }>(
        `/v1/me/permissions?boardId=${boardId}`,
        { token: editor },
      );
      expect(permissions.body.hiddenColumnKeys.sort()).toEqual(['c_termino_planejado', 'c_tipo']);
      const allowed = await api.get<Item>(`/v1/items/${itemId}`, { token: owner });
      expect(allowed.body.values).toHaveProperty('c_tipo');
    });

    it('quem gerencia o board vê todas as colunas', async () => {
      const single = await api.get<Item>(`/v1/items/${itemId}`, { token: manager });
      expect(single.body.values).toHaveProperty('c_tipo');
    });

    it('GraphQL aplica a mesma redação', async () => {
      const result = await api.graphql<{
        item: { values: Record<string, unknown>; plannedEndDate: string | null };
      }>(
        'query($id: ID!) { item(id: $id) { values plannedEndDate redactedFields } }',
        { id: itemId },
        editor,
      );
      expect(result.body.data?.item.values).not.toHaveProperty('c_tipo');
      expect(result.body.data?.item.plannedEndDate).toBeNull();
    });

    it('não permite filtrar/ordenar por coluna oculta (evita inferência)', async () => {
      const filter = { op: 'and', conditions: [{ field: 'c_tipo', operator: 'is_not_empty' }] };
      const filtered = await api.get<{ code: string }>(
        `/v1/boards/${boardId}/items?filter=${encodeURIComponent(JSON.stringify(filter))}`,
        {
          token: editor,
        },
      );
      expect(filtered.status).toBe(403);
      expect(filtered.body.code).toBe('column_forbidden');
      expect(
        (await api.get(`/v1/boards/${boardId}/items?sort=c_tipo:asc`, { token: editor })).status,
      ).toBe(403);
      expect(
        (
          await api.get(
            `/v1/boards/${boardId}/items?sort=planned_end_date:asc&filter=${encodeURIComponent(JSON.stringify({ op: 'and', conditions: [{ field: 'c_termino_planejado', operator: 'is_empty' }] }))}`,
            { token: editor },
          )
        ).status,
      ).toBe(403);
    });

    it('não altera coluna oculta nem coluna com edição restrita', async () => {
      const label = columns.c_tipo?.labels[0]?.id;
      const hidden = await api.patch<{ code: string }>(`/v1/items/${itemId}`, {
        token: editor,
        body: { values: { c_tipo: { labelId: label } } },
      });
      expect(hidden.status).toBe(403);
      const bound = await api.patch(`/v1/items/${itemId}`, {
        token: editor,
        body: { fields: { plannedEndDate: '2026-12-31' } },
      });
      expect(bound.status).toBe(403);
      const status = columns.c_status?.labels.find((entry) => entry.label === 'Em andamento')?.id;
      const restricted = await api.patch(`/v1/items/${itemId}`, {
        token: editor,
        body: { values: { c_status: { labelId: status } } },
      });
      expect(restricted.status).toBe(403);
      const carlos = await api.login(USERS.carlos);
      const allowed = await api.patch(`/v1/items/${itemId}`, {
        token: carlos,
        body: { values: { c_status: { labelId: status } } },
      });
      expect(allowed.status).toBe(200);
    });
  });

  describe('board, item e convidado', () => {
    it('leitor lê mas não altera', async () => {
      expect((await api.get(`/v1/items/${itemId}`, { token: viewer })).status).toBe(200);
      const denied = await api.patch<{ code: string }>(`/v1/items/${itemId}`, {
        token: viewer,
        body: { name: 'Leitor tentou' },
      });
      expect(denied.status).toBe(403);
    });

    it('convidado vê e altera apenas itens em que é responsável', async () => {
      const before = await api.get<Page>(`/v1/boards/${boardId}/items?limit=100`, { token: guest });
      expect(before.status).toBe(200);
      expect(before.body.data).toHaveLength(0);
      expect((await api.get(`/v1/items/${itemId}`, { token: guest })).status).toBe(404);

      const people = (await api.get<Item>(`/v1/items/${itemId}`, { token: manager })).body.values
        .c_responsaveis as { personIds: string[] };
      const assign = await api.patch(`/v1/items/${itemId}`, {
        token: manager,
        body: {
          values: {
            c_responsaveis: {
              personIds: [...people.personIds, userIds[USERS.patricia]],
              teamIds: [],
            },
          },
        },
      });
      expect(assign.status).toBe(200);

      const after = await api.get<Page>(`/v1/boards/${boardId}/items?limit=100`, { token: guest });
      expect(after.body.data.map((item) => item.id)).toEqual([itemId]);
      const update = await api.patch(`/v1/items/${itemId}`, {
        token: guest,
        body: { name: 'Atualizado pela fiscal' },
      });
      expect(update.status).toBe(200);
      expect(
        (await api.patch(`/v1/items/${otherItemId}`, { token: guest, body: { name: 'x' } })).status,
      ).toBe(404);
      expect(
        (
          await api.post(`/v1/boards/${boardId}/items`, {
            token: guest,
            body: { groupId: '01920000-0000-7000-8000-000000000000', name: 'x' },
          })
        ).status,
      ).toBe(403);
    });

    it('can() exposto via /v1/access/check', async () => {
      const check = (token: string, action: string, resource: Record<string, unknown>) =>
        api.post<{ allowed: boolean }>('/v1/access/check', { token, body: { action, resource } });
      expect(
        (await check(viewer, 'item.create', { type: 'board', id: boardId })).body.allowed,
      ).toBe(false);
      expect(
        (await check(editor, 'item.create', { type: 'board', id: boardId })).body.allowed,
      ).toBe(true);
      expect(
        (await check(editor, 'column.read', { type: 'column', boardId, key: 'c_tipo' })).body
          .allowed,
      ).toBe(false);
      expect((await check(owner, 'members.manage', { type: 'tenant' })).body.allowed).toBe(true);
      expect((await check(editor, 'members.manage', { type: 'tenant' })).body.allowed).toBe(false);
    });

    it('papéis customizados e concessões mudam o acesso imediatamente', async () => {
      const role = await api.post<{ id: string }>('/v1/roles', {
        token: owner,
        body: {
          key: 'auditor_externo',
          name: 'Auditor externo',
          scope: 'board',
          permissions: ['board.read', 'item.comment'],
        },
      });
      expect(role.status).toBe(201);
      const invalid = await api.post('/v1/roles', {
        token: owner,
        body: { key: 'invalido', name: 'Inválido', scope: 'board', permissions: ['tenant.manage'] },
      });
      expect(invalid.status).toBe(400);
      expect(
        (
          await api.post('/v1/roles', {
            token: editor,
            body: { key: 'x_y', name: 'X', scope: 'board', permissions: [] },
          })
        ).status,
      ).toBe(403);

      // A convidada recebe acesso de leitura total a um item específico por concessão explícita.
      const grant = await api.post<{ id: string }>('/v1/access-grants', {
        token: manager,
        body: {
          resourceType: 'item',
          resourceId: otherItemId,
          principalType: 'user',
          principalId: userIds[USERS.patricia],
          roleId: role.body.id,
        },
      });
      expect(grant.status).toBe(201);
      expect((await api.get(`/v1/items/${otherItemId}`, { token: guest })).status).toBe(200);
      const revoked = await api.delete(`/v1/access-grants/${grant.body.id}`, { token: manager });
      expect(revoked.status).toBe(204);
      expect((await api.get(`/v1/items/${otherItemId}`, { token: guest })).status).toBe(404);
    });

    it('view pessoal só é visível para o dono', async () => {
      const db = adminDb();
      try {
        const rows = await db.db.execute<{ id: string }>(
          sql`select id from views where name = 'Minhas demandas'`,
        );
        const viewId = rows.rows[0]?.id ?? '';
        const check = (token: string) =>
          api.post<{ allowed: boolean }>('/v1/access/check', {
            token,
            body: { action: 'view.read', resource: { type: 'view', id: viewId } },
          });
        expect((await check(editor)).body.allowed).toBe(true);
        expect((await check(manager)).body.allowed).toBe(false);
      } finally {
        await db.close();
      }
    });
  });
});
