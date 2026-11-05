import { createHmac, randomBytes } from 'node:crypto';

import { schema } from '@cube-track/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  OAUTH_CONNECTION_CLIENT,
  type OAuthConnectionClient,
} from '../src/modules/integrations/infrastructure/oauth-connection.client.js';
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

const { devEventLinks, integrationApps, integrationConnections, users } = schema;

interface Connection {
  id: string;
  provider: string;
  authKind: string;
  isActive: boolean;
  workspaceId: string;
}
interface Item {
  id: string;
  version: number;
  values: Record<string, { text?: string; labelId?: string } | undefined>;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('Integrações de terceiros (Prompt 15, parte 3, ADR 0056)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let owner: string; // ana — workspace_admin (tem integrations.manage)
  let member: string; // thiago — sem integrations.manage
  let workspaceId: string;
  let boardId: string;
  let board: BoardDetailFixture;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    owner = await api.login(USERS.ana);
    member = await api.login(USERS.thiago);
    ({ workspaceId, boardId, board } = await demoIds(api, owner));
    await resetRateLimits();
  });

  afterAll(async () => {
    await server.close();
  });

  async function listConnections(): Promise<Connection[]> {
    const response = await api.get<{ data: Connection[] }>(`/v1/workspaces/${workspaceId}/integrations`, {
      token: owner,
    });
    return response.body.data;
  }

  async function createTestItem(
    values: Record<string, unknown> = {},
    fields: Record<string, unknown> = {},
  ): Promise<Item> {
    const created = await api.post<Item>(`/v1/boards/${boardId}/items`, {
      token: owner,
      body: {
        groupId: board.groups[0]?.id,
        name: `Item de teste de integração ${randomBytes(4).toString('hex')}`,
        values: { ...requiredValues(board), ...values },
        fields,
      },
    });
    expect(created.status).toBe(201);
    return created.body;
  }

  function autoIdRef(item: Item): string {
    const text = item.values.c_id?.text;
    if (text === undefined) throw new Error('Item sem c_id (auto_id)');
    return text;
  }

  // ---------------------------------------------------------------------------------- conexões ---

  it('`integrations.manage` protege conectar, listar e desconectar integrações', async () => {
    const forbiddenConnect = await api.post(`/v1/workspaces/${workspaceId}/integrations/github/connect`, {
      token: member,
      body: { webhookSecret: 'segredo-github-primeiro-teste' },
    });
    expect(forbiddenConnect.status).toBe(403);

    const connect = await api.post(`/v1/workspaces/${workspaceId}/integrations/github/connect`, {
      token: owner,
      body: { webhookSecret: 'segredo-github-primeiro-teste' },
    });
    expect(connect.status).toBe(204);

    const forbiddenList = await api.get(`/v1/workspaces/${workspaceId}/integrations`, { token: member });
    expect(forbiddenList.status).toBe(403);

    const connections = await listConnections();
    const created = connections.find((entry) => entry.provider === 'github');
    expect(created).toBeDefined();
    expect(created?.authKind).toBe('webhook_secret');
    expect(created?.isActive).toBe(true);

    const forbiddenDisconnect = await api.delete(`/v1/integrations/${created?.id}`, { token: member });
    expect(forbiddenDisconnect.status).toBe(403);
    const disconnect = await api.delete(`/v1/integrations/${created?.id}`, { token: owner });
    expect(disconnect.status).toBe(204);
    const afterDisconnect = await listConnections();
    expect(afterDisconnect.some((entry) => entry.id === created?.id)).toBe(false);
  });

  // ----------------------------------------------------------------------------------- GitHub ---

  describe('Webhook do GitHub', () => {
    const secret = 'segredo-github-webhook-123456';
    let connectionId: string;

    beforeAll(async () => {
      const connect = await api.post(`/v1/workspaces/${workspaceId}/integrations/github/connect`, {
        token: owner,
        body: { webhookSecret: secret },
      });
      expect(connect.status).toBe(204);
      const connections = await listConnections();
      connectionId = connections.find((entry) => entry.provider === 'github')?.id ?? '';
      expect(connectionId).not.toBe('');
    });

    it('rejeita uma assinatura HMAC incorreta e aceita a correta, vinculando o item', async () => {
      const item = await createTestItem();
      const ref = autoIdRef(item);
      const payload = {
        repository: { full_name: 'org/repo' },
        commits: [
          {
            message: `Corrige #${ref}`,
            url: 'https://github.com/org/repo/commit/abc123',
            author: { name: 'Dev' },
          },
        ],
      };
      const rawBody = JSON.stringify(payload);

      const wrongSignature = await api.post(`/v1/integrations/github/${connectionId}/webhook`, {
        body: payload,
        headers: { 'x-github-event': 'push', 'x-hub-signature-256': 'sha256=0000000000' },
      });
      expect(wrongSignature.status).toBe(401);

      const validSignature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      const accepted = await api.post(`/v1/integrations/github/${connectionId}/webhook`, {
        body: payload,
        headers: { 'x-github-event': 'push', 'x-hub-signature-256': validSignature },
      });
      expect(accepted.status).toBe(200);

      const db = adminDb();
      try {
        const rows = await db.db
          .select()
          .from(devEventLinks)
          .where(and(eq(devEventLinks.itemId, item.id), eq(devEventLinks.connectionId, connectionId)));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.kind).toBe('push');
        expect(rows[0]?.repo).toBe('org/repo');
      } finally {
        await db.close();
      }
    });

    it('PR mergeado avança o status para o rótulo "concluído" quando existe um candidato claro', async () => {
      const statusColumn = board.columns.find((column) => column.key === 'c_status');
      const doing = statusColumn?.labels.find((label) => label.category === 'in_progress');
      const done = statusColumn?.labels.find((label) => label.category === 'done');
      expect(doing).toBeDefined();
      expect(done).toBeDefined();
      // `c_termino_realizado` é obrigatório condicionalmente quando o status vira "Concluído" (seed do
      // board PMSP) — preenche de antemão para o auto-avanço (só muda `c_status`) não esbarrar nisso.
      const item = await createTestItem({ c_status: { labelId: doing?.id } }, { actualEndDate: '2026-01-10' });
      const ref = autoIdRef(item);
      const payload = {
        repository: { full_name: 'org/repo' },
        action: 'closed',
        pull_request: {
          title: `Fix #${ref}`,
          body: '',
          html_url: 'https://github.com/org/repo/pull/1',
          merged: true,
          user: { login: 'dev' },
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      const response = await api.post(`/v1/integrations/github/${connectionId}/webhook`, {
        body: payload,
        headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': signature },
      });
      expect(response.status).toBe(200);

      const updated = await api.get<Item>(`/v1/items/${item.id}`, { token: owner });
      expect(updated.body.values.c_status?.labelId).toBe(done?.id);
    });

    it('PR mergeado NÃO mexe no status quando o item já está no rótulo "concluído" (nada a avançar)', async () => {
      const statusColumn = board.columns.find((column) => column.key === 'c_status');
      const done = statusColumn?.labels.find((label) => label.category === 'done');
      const item = await createTestItem({ c_status: { labelId: done?.id } }, { actualEndDate: '2026-01-10' });
      const ref = autoIdRef(item);
      const payload = {
        repository: { full_name: 'org/repo' },
        action: 'closed',
        pull_request: {
          title: `Fix #${ref}`,
          body: '',
          html_url: 'https://github.com/org/repo/pull/2',
          merged: true,
          user: { login: 'dev' },
        },
      };
      const rawBody = JSON.stringify(payload);
      const signature = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
      const response = await api.post(`/v1/integrations/github/${connectionId}/webhook`, {
        body: payload,
        headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': signature },
      });
      expect(response.status).toBe(200);

      const unchanged = await api.get<Item>(`/v1/items/${item.id}`, { token: owner });
      expect(unchanged.body.version).toBe(item.version);
      expect(unchanged.body.values.c_status?.labelId).toBe(done?.id);

      const db = adminDb();
      try {
        const rows = await db.db
          .select()
          .from(devEventLinks)
          .where(and(eq(devEventLinks.itemId, item.id), eq(devEventLinks.connectionId, connectionId)));
        expect(rows).toHaveLength(1);
      } finally {
        await db.close();
      }
    });
  });

  // ----------------------------------------------------------------------------------- GitLab ---

  it('webhook do GitLab: rejeita token incorreto e aceita o token configurado', async () => {
    const secret = 'token-gitlab-webhook-abcdef';
    const connect = await api.post(`/v1/workspaces/${workspaceId}/integrations/gitlab/connect`, {
      token: owner,
      body: { webhookSecret: secret },
    });
    expect(connect.status).toBe(204);
    const connectionId = (await listConnections()).find((entry) => entry.provider === 'gitlab')?.id ?? '';

    const item = await createTestItem();
    const ref = autoIdRef(item);
    const payload = {
      object_kind: 'push',
      project: { path_with_namespace: 'org/repo', web_url: 'https://gitlab.com/org/repo' },
      commits: [{ message: `Corrige #${ref}`, url: 'https://gitlab.com/org/repo/-/commit/abc', author: { name: 'Dev' } }],
    };

    const wrongToken = await api.post(`/v1/integrations/gitlab/${connectionId}/webhook`, {
      body: payload,
      headers: { 'x-gitlab-token': 'token-errado' },
    });
    expect(wrongToken.status).toBe(401);

    const accepted = await api.post(`/v1/integrations/gitlab/${connectionId}/webhook`, {
      body: payload,
      headers: { 'x-gitlab-token': secret },
    });
    expect(accepted.status).toBe(200);

    const db = adminDb();
    try {
      const rows = await db.db
        .select()
        .from(devEventLinks)
        .where(and(eq(devEventLinks.itemId, item.id), eq(devEventLinks.connectionId, connectionId)));
      expect(rows).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  // ------------------------------------------------------------------------------ Azure DevOps ---

  it('service hook do Azure DevOps: rejeita credenciais erradas e aceita o usuário/senha configurados', async () => {
    const username = 'cubetrack-hook';
    const password = 'senha-azure-devops-123456';
    const connect = await api.post(`/v1/workspaces/${workspaceId}/integrations/azure-devops/connect`, {
      token: owner,
      body: { username, password },
    });
    expect(connect.status).toBe(204);
    const connectionId = (await listConnections()).find((entry) => entry.provider === 'azure_devops')?.id ?? '';

    const item = await createTestItem();
    const ref = autoIdRef(item);
    const payload = {
      eventType: 'git.push',
      resource: {
        repository: { name: 'repo' },
        commits: [{ comment: `Corrige #${ref}`, url: 'https://dev.azure.com/org/repo/commit/abc', author: { name: 'Dev' } }],
      },
    };

    const wrongAuth = await api.post(`/v1/integrations/azure-devops/${connectionId}/webhook`, {
      body: payload,
      headers: { authorization: basicAuth(username, 'senha-errada') },
    });
    expect(wrongAuth.status).toBe(401);

    const accepted = await api.post(`/v1/integrations/azure-devops/${connectionId}/webhook`, {
      body: payload,
      headers: { authorization: basicAuth(username, password) },
    });
    expect(accepted.status).toBe(200);

    const db = adminDb();
    try {
      const rows = await db.db
        .select()
        .from(devEventLinks)
        .where(and(eq(devEventLinks.itemId, item.id), eq(devEventLinks.connectionId, connectionId)));
      expect(rows).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  // ------------------------------------------------------------------------------------- Slack ---

  describe('Events API / comando de barra do Slack', () => {
    const signingSecret = 'segredo-de-assinatura-do-app-slack';
    let connectionId: string;

    beforeAll(async () => {
      const connect = await api.post(`/v1/workspaces/${workspaceId}/integrations/slack/connect`, {
        token: owner,
        body: {
          incomingWebhookUrl: 'https://hooks.slack.example.com/services/T000/B000/XXXXXXXX',
          signingSecret,
          defaultBoardId: boardId,
        },
      });
      expect(connect.status).toBe(204);
      connectionId = (await listConnections()).find((entry) => entry.provider === 'slack')?.id ?? '';
      expect(connectionId).not.toBe('');
    });

    function sign(timestamp: string, rawBody: string): string {
      return `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
    }

    it('aceita uma assinatura válida e cria o item via comando de barra', async () => {
      const body = { command: '/cubetrack', text: 'create Item criado via Slack', user_id: 'U1', team_id: 'T1' };
      const rawBody = JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const response = await api.post<{ response_type: string; text: string }>(
        `/v1/integrations/slack/${connectionId}/events`,
        {
          body,
          headers: { 'x-slack-signature': sign(timestamp, rawBody), 'x-slack-request-timestamp': timestamp },
        },
      );
      expect(response.status).toBe(200);
      expect(response.body.text).toContain('Item criado');
    });

    it('rejeita uma assinatura inválida', async () => {
      const body = { command: '/cubetrack', text: 'create Outro item', user_id: 'U1', team_id: 'T1' };
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const response = await api.post(`/v1/integrations/slack/${connectionId}/events`, {
        body,
        headers: { 'x-slack-signature': 'v0=0000000000', 'x-slack-request-timestamp': timestamp },
      });
      expect(response.status).toBe(404);
    });

    it('rejeita um timestamp com mais de 5 minutos (replay)', async () => {
      const body = { command: '/cubetrack', text: 'create Item antigo', user_id: 'U1', team_id: 'T1' };
      const rawBody = JSON.stringify(body);
      const staleTimestamp = String(Math.floor(Date.now() / 1_000) - 600);
      const response = await api.post(`/v1/integrations/slack/${connectionId}/events`, {
        body,
        headers: {
          'x-slack-signature': sign(staleTimestamp, rawBody),
          'x-slack-request-timestamp': staleTimestamp,
        },
      });
      expect(response.status).toBe(404);
    });

    it('responde ao desafio `url_verification` com o `challenge` recebido', async () => {
      const body = { type: 'url_verification', challenge: 'um-desafio-qualquer' };
      const rawBody = JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const response = await api.post(`/v1/integrations/slack/${connectionId}/events`, {
        body,
        headers: { 'x-slack-signature': sign(timestamp, rawBody), 'x-slack-request-timestamp': timestamp },
      });
      expect(response.status).toBe(200);
    });
  });

  // ------------------------------------------------------------------------- OAuth Google/Microsoft ---

  describe('Conexão OAuth do Google (estado/nonce e armazenamento do token)', () => {
    it('round-trip completo: estado único, token cifrado armazenado e estado reutilizado é rejeitado', async () => {
      const oauthClient = server.app.get<OAuthConnectionClient>(OAUTH_CONNECTION_CLIENT);
      const exchangeSpy = vi.spyOn(oauthClient, 'exchangeCode').mockResolvedValue({
        accessToken: 'mock-google-access-token',
        refreshToken: 'mock-google-refresh-token',
        expiresInSeconds: 3600,
      });

      const connect = await api.post<{ authorizationUrl: string }>(
        `/v1/workspaces/${workspaceId}/integrations/google/connect`,
        { token: owner, body: { clientId: 'google-client-id', clientSecret: 'google-client-secret' } },
      );
      expect(connect.status).toBe(200);
      const authorizationUrl = new URL(connect.body.authorizationUrl);
      expect(authorizationUrl.hostname).toBe('accounts.google.com');
      const state = authorizationUrl.searchParams.get('state');
      expect(state).toBeTruthy();

      const callback = await api.get(`/v1/integrations/google/callback?code=mock-code&state=${state}`);
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toContain('status=ok');
      expect(exchangeSpy).toHaveBeenCalledTimes(1);

      const db = adminDb();
      try {
        const [ownerUser] = await db.db.select({ id: users.id }).from(users).where(eq(users.email, USERS.ana));
        const [app] = await db.db
          .select()
          .from(integrationApps)
          .where(and(eq(integrationApps.workspaceId, workspaceId), eq(integrationApps.provider, 'google')));
        expect(app?.clientId).toBe('google-client-id');
        const [connection] = await db.db
          .select()
          .from(integrationConnections)
          .where(
            and(
              eq(integrationConnections.workspaceId, workspaceId),
              eq(integrationConnections.provider, 'google'),
              eq(integrationConnections.userId, ownerUser?.id ?? ''),
            ),
          );
        expect(connection).toBeDefined();
        expect(connection?.authKind).toBe('oauth');
        expect(connection?.accessTokenCiphertext?.startsWith('v1:')).toBe(true);
        expect(connection?.accessTokenCiphertext).not.toContain('mock-google-access-token');
        expect(connection?.refreshTokenCiphertext?.startsWith('v1:')).toBe(true);
        expect(connection?.tokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
      } finally {
        await db.close();
      }

      // O estado já foi consumido no primeiro callback — reusar falha (redireciona com erro).
      const reused = await api.get(`/v1/integrations/google/callback?code=mock-code&state=${state}`);
      expect(reused.status).toBe(302);
      expect(reused.headers.get('location')).toContain('error=');
      exchangeSpy.mockRestore();
    });
  });
});
