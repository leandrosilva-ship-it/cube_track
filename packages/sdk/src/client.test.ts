import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createClient } from './index.js';

const BASE_URL = 'https://api.cubetrack.example.com';
const TOKEN = 'ctk_test_token_abc123';

function jsonResponse(status: number, body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

function noContentResponse(): Response {
  return new Response(null, { status: 204 });
}

describe('createClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia `Authorization: Bearer <token>` e `Accept: application/json` em toda chamada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });
    await client.me.tokens.list();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/me/tokens`);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.accept).toBe('application/json');
  });

  it('lança `ApiError` com os campos do RFC 7807 quando a API responde um erro', async () => {
    const problem = {
      type: 'https://cubetrack.example.com/problems/not-found',
      title: 'Não encontrado',
      status: 404,
      detail: 'Token não encontrado',
      code: 'token_not_found',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, problem, 'application/problem+json'));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });

    await expect(client.me.tokens.revoke('00000000-0000-0000-0000-000000000001')).rejects.toSatisfy(
      (error) => {
        expect(error).toBeInstanceOf(ApiError);
        const apiError = error as ApiError;
        expect(apiError.status).toBe(404);
        expect(apiError.code).toBe('token_not_found');
        expect(apiError.message).toBe('Token não encontrado');
        return true;
      },
    );
  });

  it('me.tokens.create() faz POST /v1/me/tokens com o corpo informado', async () => {
    const created = {
      id: '00000000-0000-0000-0000-000000000002',
      userId: null,
      userName: null,
      oauthAppId: null,
      name: 'Script de integração',
      tokenPrefix: 'ctk_abcd',
      scopes: ['boards:read'],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: '2026-11-05T00:00:00.000Z',
      token: 'ctk_abcdefghij',
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, created));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });
    const result = await client.me.tokens.create({
      name: 'Script de integração',
      scopes: ['boards:read'],
    });

    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/me/tokens`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Script de integração',
      scopes: ['boards:read'],
    });
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('templates.list() faz GET /v1/templates com a query string correta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });
    await client.templates.list({ scope: 'public', kind: 'board' });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/v1/templates');
    expect(parsed.searchParams.get('scope')).toBe('public');
    expect(parsed.searchParams.get('kind')).toBe('board');
  });

  it('webhooks.resendDelivery() faz POST /v1/webhook-deliveries/{id}/resend substituindo o path param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        id: '00000000-0000-0000-0000-000000000003',
        webhookId: '00000000-0000-0000-0000-000000000004',
        eventId: '00000000-0000-0000-0000-000000000005',
        eventType: 'item.updated',
        status: 'pending',
        attempt: 1,
        responseStatus: null,
        responseBody: null,
        error: null,
        durationMs: null,
        deliveredAt: null,
        createdAt: '2026-11-05T00:00:00.000Z',
        resentFromId: null,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });
    const deliveryId = '00000000-0000-0000-0000-000000000006';
    await client.webhooks.resendDelivery(deliveryId);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/webhook-deliveries/${deliveryId}/resend`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('trata resposta 204 Sem Conteúdo como sucesso sem corpo (ex.: revoke/remove)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContentResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });
    await expect(
      client.oauthApps.remove('00000000-0000-0000-0000-000000000007'),
    ).resolves.toBeUndefined();
  });

  it('o escape hatch `request()` chama qualquer rota documentada com a mesma tipagem', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({ baseUrl: BASE_URL, token: TOKEN });
    await client.request('/v1/oauth-apps', 'get');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/v1/oauth-apps`);
    expect(init.method).toBe('GET');
  });
});
