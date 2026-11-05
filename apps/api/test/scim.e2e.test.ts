import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { client, DEMO_PASSWORD, resetRateLimits, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface Session {
  accessToken: string;
}
interface ApiTokenWithSecret {
  token: string;
}
interface ScimUser {
  id: string;
  userName: string;
  active: boolean;
}

/** SCIM 2.0 (ADR 0057) — autenticado pelo MESMO token de API da plataforma (`scim:manage`), fora do
 * prefixo `/v1` (`/scim/v2/...`), contra PostgreSQL real sob RLS. */
describe('SCIM 2.0', () => {
  let server: ApiServer;
  let api: ApiClient;
  let scimToken: string;

  beforeAll(async () => {
    const started = await startApi();
    server = started;
    api = client(server.url);
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    const created = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: login.body.accessToken,
      body: { name: 'Provedor SCIM corporativo', scopes: ['scim:manage'] },
    });
    scimToken = created.body.token;
  });

  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await server.close();
  });

  it('um token sem scim:manage não acessa /scim/v2/Users (teto de escopo)', async () => {
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    const noScim = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: login.body.accessToken,
      body: { name: 'Sem escopo SCIM', scopes: ['boards:read'] },
    });
    const response = await api.get('/scim/v2/Users', { token: noScim.body.token });
    expect(response.status).toBe(403);
  });

  it('lista, cria, lê, desativa e reativa um usuário via SCIM', async () => {
    const list = await api.get<{ Resources: ScimUser[]; totalResults: number }>('/scim/v2/Users', {
      token: scimToken,
    });
    expect(list.status).toBe(200);
    expect(list.body.totalResults).toBeGreaterThan(0);

    const created = await api.post<ScimUser>('/scim/v2/Users', {
      token: scimToken,
      body: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'scim.provisionado@empresademo.com.br',
        displayName: 'Provisionado via SCIM',
        emails: [{ value: 'scim.provisionado@empresademo.com.br', primary: true }],
        active: true,
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'TI' },
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.active).toBe(true);
    const userId = created.body.id;

    const fetched = await api.get<ScimUser>(`/scim/v2/Users/${userId}`, { token: scimToken });
    expect(fetched.status).toBe(200);
    expect(fetched.body.userName).toBe('scim.provisionado@empresademo.com.br');

    const deactivated = await api.patch(`/scim/v2/Users/${userId}`, {
      token: scimToken,
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      },
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const reactivated = await api.put(`/scim/v2/Users/${userId}`, {
      token: scimToken,
      body: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'scim.provisionado@empresademo.com.br',
        emails: [{ value: 'scim.provisionado@empresademo.com.br', primary: true }],
        active: true,
      },
    });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.active).toBe(true);

    const deleted = await api.delete(`/scim/v2/Users/${userId}`, { token: scimToken });
    expect(deleted.status).toBe(204);
    const afterDelete = await api.get<ScimUser>(`/scim/v2/Users/${userId}`, { token: scimToken });
    expect(afterDelete.body.active).toBe(false);
  });

  it('Groups: lista somente leitura espelhando os times', async () => {
    const response = await api.get('/scim/v2/Groups', { token: scimToken });
    expect(response.status).toBe(200);
  });
});
