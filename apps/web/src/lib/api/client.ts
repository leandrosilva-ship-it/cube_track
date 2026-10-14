import { refreshSession } from '@/lib/auth/session';
import { sessionStore } from '@/stores/session';

import { ApiError, NetworkError, type ProblemDetails } from './errors';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** Envia o access token (padrão). Rotas públicas de autenticação usam `false`. */
  auth?: boolean;
  /** Correlaciona o eco realtime com a mutação otimista (ADR 0008/0033). */
  clientMutationId?: string;
  /** Torna POSTs seguros para reenvio (ADR 0030). */
  idempotencyKey?: string;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { accessToken } = sessionStore.getState();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.auth !== false && accessToken !== null)
    headers.authorization = `Bearer ${accessToken}`;
  if (options.clientMutationId !== undefined)
    headers['x-client-mutation-id'] = options.clientMutationId;
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(error instanceof Error ? error.message : 'network');
  }
}

async function problemOf(response: Response): Promise<ProblemDetails> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return { status: response.status, ...((await response.json()) as Partial<ProblemDetails>) };
    } catch {
      return { status: response.status };
    }
  }
  return { status: response.status, detail: response.statusText };
}

/**
 * Cliente da API v1 (mesma origem, via rewrite do Next). Em 401 renova a sessão uma vez e repete;
 * erros viram `ApiError` com o problem+json (RFC 7807).
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && options.auth !== false && (await refreshSession())) {
    response = await send(path, options);
  }
  if (!response.ok) throw new ApiError(response.status, await problemOf(response));
  if (response.status === 204) return undefined as T;
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('json') ? await response.json() : undefined) as T;
}

export function newMutationId(): string {
  return crypto.randomUUID();
}
