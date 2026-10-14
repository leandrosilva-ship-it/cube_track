import type { AddressInfo } from 'node:net';

import { createDatabase, DEMO_PASSWORD, DEMO_TENANT_ID, type DatabaseHandle } from '@cube-track/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Redis } from 'ioredis';
import { inject } from 'vitest';

import { createApp, mountOpenApi } from '../src/bootstrap.js';

export { DEMO_PASSWORD, DEMO_TENANT_ID };

export interface ApiServer {
  app: NestExpressApplication;
  url: string;
  close: () => Promise<void>;
}

export async function startApi(): Promise<ApiServer> {
  const app = await createApp({ logger: false });
  mountOpenApi(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}`, close: () => app.close() };
}

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

export interface RequestOptions {
  token?: string | undefined;
  body?: unknown;
  headers?: Record<string, string>;
}

export function client(baseUrl: string) {
  const request = async <T = Record<string, unknown>>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    const isJson = (response.headers.get('content-type') ?? '').includes('json');
    return {
      status: response.status,
      body: (text === '' || !isJson ? {} : JSON.parse(text)) as T,
      headers: response.headers,
    };
  };
  return {
    get: <T = Record<string, unknown>>(path: string, options?: RequestOptions) =>
      request<T>('GET', path, options),
    post: <T = Record<string, unknown>>(path: string, options?: RequestOptions) =>
      request<T>('POST', path, options),
    patch: <T = Record<string, unknown>>(path: string, options?: RequestOptions) =>
      request<T>('PATCH', path, options),
    delete: <T = Record<string, unknown>>(path: string, options?: RequestOptions) =>
      request<T>('DELETE', path, options),
    async login(email: string, password = DEMO_PASSWORD): Promise<string> {
      const response = await request<{ accessToken?: string }>('POST', '/v1/auth/login', {
        body: { email, password },
      });
      if (response.status !== 200 || response.body.accessToken === undefined) {
        throw new Error(
          `Login falhou para ${email}: ${response.status} ${JSON.stringify(response.body)}`,
        );
      }
      return response.body.accessToken;
    },
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- tipo do `data` informado pelo teste
    async graphql<T = Record<string, unknown>>(
      query: string,
      variables: Record<string, unknown>,
      token: string,
    ): Promise<
      ApiResponse<{
        data?: T;
        errors?: { message: string; extensions?: Record<string, unknown> }[];
      }>
    > {
      return request<{
        data?: T;
        errors?: { message: string; extensions?: Record<string, unknown> }[];
      }>('POST', '/v1/graphql', {
        token,
        body: { query, variables },
      });
    },
  };
}

export type ApiClient = ReturnType<typeof client>;

export const USERS = {
  ana: 'ana.ribeiro@empresademo.com.br',
  carlos: 'carlos.lima@empresademo.com.br',
  fernanda: 'fernanda.souza@empresademo.com.br',
  rafael: 'rafael.mendes@empresademo.com.br',
  juliana: 'juliana.castro@empresademo.com.br',
  thiago: 'thiago.pereira@empresademo.com.br',
  patricia: 'patricia.gomes@cliente.exemplo.gov.br',
} as const;

export function adminDb(): DatabaseHandle {
  return createDatabase(inject('adminUrl'), { max: 2 });
}

/** Ids úteis do seed (board PMSP, colunas, grupos). */
export async function demoIds(api: ApiClient, token: string) {
  const workspaces = await api.get<{ data: { id: string }[] }>('/v1/workspaces', { token });
  const workspaceId = workspaces.body.data[0]?.id ?? '';
  const boards = await api.get<{ data: { id: string; name: string }[] }>(
    `/v1/workspaces/${workspaceId}/boards`,
    { token },
  );
  const boardId = boards.body.data.find((board) => board.name === 'PMSP')?.id ?? '';
  const board = await api.get<{
    groups: { id: string; name: string }[];
    columns: { id: string; key: string; labels: { id: string; label: string }[] }[];
  }>(`/v1/boards/${boardId}`, { token });
  return { workspaceId, boardId, board: board.body };
}

export async function waitFor<T>(
  check: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 5_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('Tempo esgotado aguardando condição');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Zera os contadores de rate limit (testes executam muitas requisições do mesmo IP). */
export async function resetRateLimits(): Promise<void> {
  const redis = new Redis(inject('redisUrl'));
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    await redis.quit();
  }
}
