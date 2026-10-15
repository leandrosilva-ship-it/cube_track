import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listRoutes } from '../src/openapi/openapi.js';
import {
  client,
  demoIds,
  requiredValues,
  startApi,
  USERS,
  type ApiClient,
  type ApiResponse,
  type ApiServer,
} from './helpers.js';

interface Page {
  data: { id: string; name: string; values: Record<string, unknown> }[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

describe('API REST — contrato, paginação, erros, rate limit e idempotência', () => {
  let server: ApiServer;
  let api: ApiClient;
  let token: string;
  let boardId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    token = await api.login(USERS.fernanda);
    ({ boardId } = await demoIds(api, token));
  });

  afterAll(async () => {
    await server.close();
  });

  it('health live/ready fora do prefixo /v1', async () => {
    expect((await api.get('/health/live')).status).toBe(200);
    const ready = await api.get<{ checks: Record<string, { status: string }> }>('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.postgres?.status).toBe('up');
  });

  it('toda rota que altera dados é auditada (ou explicitamente somente leitura)', () => {
    const routes = listRoutes(server.app);
    expect(routes.length).toBeGreaterThan(30);
    const mutating = routes.filter((route) =>
      ['post', 'put', 'patch', 'delete'].includes(route.method),
    );
    const unaudited = mutating
      .filter((route) => route.audited === undefined && !route.readOnly)
      .map((route) => `${route.method} ${route.path}`);
    expect(unaudited).toEqual([]);
    const undocumented = routes
      .filter((route) => route.endpoint === undefined)
      .map((route) => `${route.method} ${route.path}`);
    expect(undocumented).toEqual([]);
  });

  it('publica o OpenAPI 3.1 com todas as rotas', async () => {
    const response = await api.get<{
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    }>('/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.paths['/v1/boards/{boardId}/items']?.get).toBeDefined();
    expect(response.body.paths['/v1/auth/login']?.post).toBeDefined();
  });

  it('pagina por cursor sem repetir nem perder itens', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `/v1/boards/${boardId}/items?limit=7&sort=name:asc${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      const response: ApiResponse<Page> = await api.get<Page>(query, { token });
      expect(response.status).toBe(200);
      for (const item of response.body.data) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = response.body.pageInfo.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 20);
    expect(seen.size).toBe(60);
    expect(pages).toBe(9);
  });

  it('ordena com nulos por último nas duas direções', async () => {
    for (const direction of ['asc', 'desc']) {
      const response = await api.get<{ data: { plannedEndDate: string | null }[] }>(
        `/v1/boards/${boardId}/items?limit=100&sort=planned_end_date:${direction}`,
        { token },
      );
      const dates = response.body.data.map((item) => item.plannedEndDate);
      const firstNull = dates.indexOf(null);
      expect(firstNull).toBeGreaterThan(0);
      expect(dates.slice(firstNull).every((value) => value === null)).toBe(true);
      const nonNull = dates.slice(0, firstNull) as string[];
      const sorted = [...nonNull].sort();
      expect(nonNull).toEqual(direction === 'asc' ? sorted : sorted.reverse());
    }
  });

  it('filtra por AST JSON (status, texto e datas)', async () => {
    const { board } = await demoIds(api, token);
    const concluido = board.columns
      .find((column) => column.key === 'c_status')
      ?.labels.find((label) => label.label === 'Concluído')?.id;
    const filter = {
      op: 'and',
      conditions: [
        { field: 'c_status', operator: 'any_of', value: [concluido] },
        { field: 'name', operator: 'contains', value: 'sei' },
      ],
    };
    const response = await api.get<Page>(
      `/v1/boards/${boardId}/items?filter=${encodeURIComponent(JSON.stringify(filter))}`,
      { token },
    );
    expect(response.status).toBe(200);
    expect(response.body.data.map((item) => item.name)).toEqual([
      'SMIT - SEI – Assinatura eletrônica em lote',
    ]);
    const range = {
      op: 'and',
      conditions: [
        { field: 'actual_end_date', operator: 'between', value: ['2025-01-01', '2025-12-31'] },
      ],
    };
    const ranged = await api.get<Page>(
      `/v1/boards/${boardId}/items?limit=100&filter=${encodeURIComponent(JSON.stringify(range))}`,
      { token },
    );
    expect(ranged.body.data.length).toBeGreaterThan(0);
  });

  it('erros seguem RFC 7807', async () => {
    const response = await api.get<{
      type: string;
      status: number;
      code: string;
      errors: { path: string }[];
    }>(`/v1/boards/${boardId}/items?limit=9999`, { token });
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 400, code: 'validation_failed' });
    expect(response.body.type).toMatch(/^https:\/\/docs\.cubetrack\.com\.br\/problems\//);
    expect(response.body.errors[0]?.path).toBe('query.limit');
    const notFound = await api.get(`/v1/items/01920000-0000-7000-8000-00000000ffff`, { token });
    expect(notFound.status).toBe(404);
    const badCursor = await api.get(`/v1/boards/${boardId}/items?cursor=abc`, { token });
    expect(badCursor.status).toBe(400);
  });

  it('idempotency-key reaproveita a resposta e rejeita corpo diferente', async () => {
    const { board } = await demoIds(api, token);
    const groupId = board.groups[0]?.id ?? '';
    const key = `teste-idem-${Date.now()}`;
    const body = { groupId, name: 'Item idempotente', values: requiredValues(board) };
    const first = await api.post<{ id: string }>(`/v1/boards/${boardId}/items`, {
      token,
      body,
      headers: { 'idempotency-key': key },
    });
    const second = await api.post<{ id: string }>(`/v1/boards/${boardId}/items`, {
      token,
      body,
      headers: { 'idempotency-key': key },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    const conflict = await api.post(`/v1/boards/${boardId}/items`, {
      token,
      body: { ...body, name: 'Outro' },
      headers: { 'idempotency-key': key },
    });
    expect(conflict.status).toBe(422);
    await api.delete(`/v1/items/${first.body.id}`, { token });
  });

  it('limita tentativas de login (429 com Retry-After)', async () => {
    let last = 0;
    let headers: Headers | undefined;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await api.post('/v1/auth/login', {
        body: { email: 'rate.limit@exemplo.com', password: 'Errada-123456' },
      });
      last = response.status;
      headers = response.headers;
    }
    expect(last).toBe(429);
    expect(headers?.get('retry-after')).not.toBeNull();
  });

  it('GraphQL usa o mesmo contrato de itens e reporta erros com código', async () => {
    const result = await api.graphql<{
      items: { data: { id: string }[]; pageInfo: { hasNextPage: boolean } };
    }>(
      'query($boardId: ID!) { items(boardId: $boardId, first: 5, sort: "name:asc") { data { id name } pageInfo { hasNextPage nextCursor } } }',
      { boardId },
      token,
    );
    expect(result.body.errors).toBeUndefined();
    expect(result.body.data?.items.data).toHaveLength(5);
    const invalid = await api.graphql(
      'query($id: ID!) { item(id: $id) { id } }',
      { id: '01920000-0000-7000-8000-00000000ffff' },
      token,
    );
    expect(invalid.body.errors?.[0]?.extensions?.code).toBe('not_found');
  });
});
