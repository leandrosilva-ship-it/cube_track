import { schema } from '@cube-track/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
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

interface ApiToken {
  id: string;
  userId: string | null;
  oauthAppId: string | null;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
}
interface ApiTokenWithSecret extends ApiToken {
  token: string;
}
interface OAuthApp {
  id: string;
  name: string;
  clientId: string;
  scopes: string[];
  isActive: boolean;
}
interface OAuthAppWithSecret extends OAuthApp {
  clientSecret: string;
}

describe('API pública — tokens, apps OAuth, escopos e limite de requisições (ADR 0056)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string; // ana (owner — tem api_tokens.manage)
  let member: string; // thiago (viewer — sem api_tokens.manage)
  let boardId: string;
  let board: BoardDetailFixture;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    member = await api.login(USERS.thiago);
    ({ boardId, board } = await demoIds(api, owner));
    await resetRateLimits();
  });

  afterAll(async () => {
    await server.close();
  });

  it('cria, lista e revoga um token pessoal (autosserviço, sem permissão especial)', async () => {
    const created = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: { name: 'Script de sincronização', scopes: ['boards:read', 'items:read'] },
    });
    expect(created.status).toBe(201);
    expect(created.body.token.startsWith('ctk_')).toBe(true);
    expect(created.body.userId).not.toBeNull();

    const list = await api.get<{ data: ApiToken[] }>('/v1/me/tokens', { token: owner });
    const listed = list.body.data.find((entry) => entry.id === created.body.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('token');
    expect(listed?.tokenPrefix.startsWith('ctk_')).toBe(true);

    const removed = await api.delete(`/v1/me/tokens/${created.body.id}`, { token: owner });
    expect(removed.status).toBe(204);
    const afterRevoke = await api.get<{ data: ApiToken[] }>('/v1/me/tokens', { token: owner });
    expect(afterRevoke.body.data.find((entry) => entry.id === created.body.id)?.revokedAt).not.toBeNull();
  });

  it('um token revogado ou expirado é rejeitado pelo AuthGuard', async () => {
    const created = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: { name: 'Token para revogar', scopes: ['boards:read'] },
    });
    const revokedToken = created.body.token;
    await api.delete(`/v1/me/tokens/${created.body.id}`, { token: owner });
    const afterRevoke = await api.get(`/v1/boards/${boardId}`, { token: revokedToken });
    expect(afterRevoke.status).toBe(401);

    const expired = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: {
        name: 'Token já expirado',
        scopes: ['boards:read'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(expired.status).toBe(201);
    expect(expired.body.expiresAt).not.toBeNull();
    // Volta a expiração para o passado direto no banco (o endpoint exige uma data futura) e confirma
    // que `TokenService.verifyApiToken` rejeita.
    const db = adminDb();
    try {
      await db.db
        .update(schema.apiTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.apiTokens.id, expired.body.id));
    } finally {
      await db.close();
    }
    const afterExpiry = await api.get(`/v1/boards/${boardId}`, { token: expired.body.token });
    expect(afterExpiry.status).toBe(401);
  });

  it('o escopo do token restringe a ação mesmo quando o dono poderia fazê-la pela sessão normal', async () => {
    const readOnly = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: { name: 'Só leitura de boards', scopes: ['boards:read'] },
    });
    const readToken = readOnly.body.token;

    const readBoard = await api.get(`/v1/boards/${boardId}`, { token: readToken });
    expect(readBoard.status).toBe(200);

    const createItem = await api.post(`/v1/boards/${boardId}/items`, {
      token: readToken,
      body: { groupId: board.groups[0]?.id, name: 'Criado via token sem escopo', values: requiredValues(board) },
    });
    expect(createItem.status).toBe(403);

    const withWrite = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: { name: 'Com escopo de escrita', scopes: ['items:write'] },
    });
    const writeToken = withWrite.body.token;
    const createItem2 = await api.post(`/v1/boards/${boardId}/items`, {
      token: writeToken,
      body: { groupId: board.groups[0]?.id, name: 'Criado via token com escopo', values: requiredValues(board) },
    });
    expect(createItem2.status).toBe(201);

    // Ação fora do catálogo de escopos de API (convidar membro) nunca é permitida por token, mesmo que
    // o dono seja owner e o token declare todos os escopos existentes — administração de membros
    // continua exigindo sessão de login normal (ADR 0056).
    const allScopes = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: {
        name: 'Todos os escopos',
        scopes: ['boards:read', 'boards:write', 'items:read', 'items:write', 'automations:manage', 'webhooks:manage', 'templates:manage', 'files:read', 'files:write'],
      },
    });
    const createRole = await api.post('/v1/roles', {
      token: allScopes.body.token,
      body: { key: 'papel_via_token', name: 'Papel via token', scope: 'tenant', permissions: [] },
    });
    expect(createRole.status).toBe(403);
  });

  it('um token nunca autentica a criação/gestão de outro token (`/v1/me/tokens` exige sessão)', async () => {
    const created = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: { name: 'Token base', scopes: ['boards:read'] },
    });
    const viaToken = await api.post('/v1/me/tokens', {
      token: created.body.token,
      body: { name: 'Token filho', scopes: ['boards:read'] },
    });
    expect(viaToken.status).toBe(403);
  });

  it('`api_tokens.manage` é exigido para listar/revogar tokens de QUALQUER usuário', async () => {
    const theirs = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: member,
      body: { name: 'Token do thiago', scopes: ['boards:read'] },
    });
    expect(theirs.status).toBe(201);

    const forbiddenList = await api.get('/v1/tokens', { token: member });
    expect(forbiddenList.status).toBe(403);
    const forbiddenRevoke = await api.delete(`/v1/tokens/${theirs.body.id}`, { token: member });
    expect(forbiddenRevoke.status).toBe(403);

    const adminList = await api.get<{ data: ApiToken[] }>('/v1/tokens', { token: owner });
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.some((entry) => entry.id === theirs.body.id)).toBe(true);
    const adminRevoke = await api.delete(`/v1/tokens/${theirs.body.id}`, { token: owner });
    expect(adminRevoke.status).toBe(204);

    // Sem `api_tokens.manage`, o próprio usuário só vê/revoga os SEUS tokens pelo autosserviço.
    const own = await api.get<{ data: ApiToken[] }>('/v1/me/tokens', { token: member });
    expect(own.status).toBe(200);
  });

  it('fluxo client_credentials emite um token com os escopos do app (nunca mais do que isso)', async () => {
    const forbiddenCreate = await api.post('/v1/oauth-apps', {
      token: member,
      body: { name: 'App sem permissão', scopes: ['boards:read'] },
    });
    expect(forbiddenCreate.status).toBe(403);

    const app = await api.post<OAuthAppWithSecret>('/v1/oauth-apps', {
      token: owner,
      body: { name: 'Integração de sincronização', scopes: ['boards:read', 'items:read'] },
    });
    expect(app.status).toBe(201);
    expect(app.body.clientSecret).toBeTruthy();

    const badSecret = await api.post('/v1/oauth/token', {
      body: { grant_type: 'client_credentials', client_id: app.body.clientId, client_secret: 'segredo-errado' },
    });
    expect(badSecret.status).toBe(401);

    const issued = await api.post<{ access_token: string; token_type: string; expires_in: number }>(
      '/v1/oauth/token',
      { body: { grant_type: 'client_credentials', client_id: app.body.clientId, client_secret: app.body.clientSecret } },
    );
    expect(issued.status).toBe(200);
    expect(issued.body.access_token.startsWith('ctk_')).toBe(true);
    expect(issued.body.token_type).toBe('Bearer');

    const readBoard = await api.get(`/v1/boards/${boardId}`, { token: issued.body.access_token });
    expect(readBoard.status).toBe(200);
    // O app só tem `boards:read`/`items:read` — escrever um item deve falhar mesmo sem o app ter
    // pedido um escopo além do que foi cadastrado (client_credentials sempre herda os escopos do app).
    const createItem = await api.post(`/v1/boards/${boardId}/items`, {
      token: issued.body.access_token,
      body: { groupId: board.groups[0]?.id, name: 'Via app OAuth', values: requiredValues(board) },
    });
    expect(createItem.status).toBe(403);

    await api.delete(`/v1/oauth-apps/${app.body.id}`, { token: owner });
    const afterDelete = await api.post('/v1/oauth/token', {
      body: { grant_type: 'client_credentials', client_id: app.body.clientId, client_secret: app.body.clientSecret },
    });
    expect(afterDelete.status).toBe(401);
  });

  it('limite de requisições por token dispara 429 ao ser excedido', async () => {
    await resetRateLimits();
    const created = await api.post<ApiTokenWithSecret>('/v1/me/tokens', {
      token: owner,
      body: { name: 'Token para teste de limite', scopes: ['boards:read'] },
    });
    const token = created.body.token;
    let last = 0;
    let headers: Headers | undefined;
    for (let attempt = 0; attempt < 400 && last !== 429; attempt += 1) {
      const response = await api.get(`/v1/boards/${boardId}`, { token });
      last = response.status;
      headers = response.headers;
    }
    expect(last).toBe(429);
    expect(headers?.get('ratelimit-limit')).toBe('300');
  }, 30_000);
});
