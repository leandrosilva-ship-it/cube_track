import { ApiError, NetworkError, type ProblemDetails } from './errors.js';
import type { operations, paths } from './generated/schema.js';

/**
 * Plumbing tipado por cima de `fetch`, no mesmo espírito do cliente da web
 * (`apps/web/src/lib/api/client.ts`): nada de biblioteca de geração de cliente em runtime, só um
 * wrapper fino e explícito — mas, ao contrário daquele (autenticado por cookie de sessão, mesma
 * origem), este fala com qualquer origem e autentica sempre com `Authorization: Bearer <token>`
 * (tokens `ctk_...`, pessoais ou de app OAuth — ADR 0056), pensado para consumidores de terceiros.
 */

export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'patch';

/** Qualquer operação do documento OpenAPI gerado — limite superior usado pelos tipos abaixo. */
export type Operation = operations[keyof operations];

/**
 * Tabela pré-computada `path -> method -> operação` (mapped type homomórfico sobre `keyof paths`):
 * indexação genérica direta em `paths[Path][Method]` perde a inferência em alguns casos (vira
 * `unknown`); pré-computar essa tabela uma vez e só indexá-la depois resolve isso de forma estável.
 */
type OperationLookup = {
  [Path in keyof paths]: {
    [Method in HttpMethod]: paths[Path][Method] extends never ? never : paths[Path][Method];
  };
};

/** A operação em `path`+`method`, ou `never` quando essa rota não suporta esse método. */
export type OperationAt<
  Path extends keyof paths,
  Method extends HttpMethod,
> = OperationLookup[Path][Method];

/** Todo `path` que suporta `Method` — restringe o 1º argumento de `request()` ao 2º. */
export type PathsWithMethod<Method extends HttpMethod> = {
  [Path in keyof paths]: OperationLookup[Path][Method] extends never ? never : Path;
}[keyof paths];

/** Container do corpo de requisição de uma operação, mesmo quando ela não aceita corpo nenhum. */
type RequestBodyContainer<Op> = Op extends { requestBody: infer Body }
  ? Body
  : Op extends { requestBody?: infer Body }
    ? Body
    : undefined;

/**
 * Daqui para baixo os utilitários recebem `Op` SEM o bound `extends Operation`: embora todo `Op` real
 * seja uma `Operation`, `OperationAt<Path, Method>` (usado para instanciar esses utilitários dentro do
 * próprio `request()` genérico, com `Path`/`Method` ainda abstratos) não é verificável contra esse
 * bound em tempo de declaração — só em cada instanciação concreta (cada chamada com literais). Exigir
 * o bound aqui faria o próprio `http.ts` falhar ao compilar; cada instanciação real continua tipada
 * corretamente porque `OperationAt`/`OperationLookup` nunca produzem algo fora do formato esperado.
 */

/** Corpo JSON esperado por uma operação, ou `undefined` quando ela não tem corpo. */
export type JsonBodyOf<Op> =
  RequestBodyContainer<Op> extends { content: { 'application/json': infer Body } }
    ? Body
    : undefined;

/** `true` quando o corpo da requisição é obrigatório (schema sem `?` em `requestBody`). */
type HasRequiredBody<Op> = Op extends { requestBody: unknown } ? true : false;

/** Parâmetros de path de uma operação, ou `never` quando ela não tem nenhum. */
export type PathParamsOf<Op> = Op extends { parameters: { path?: infer Path } } ? Path : never;

/** Parâmetros de query de uma operação, ou `never` quando ela não tem nenhum. */
export type QueryParamsOf<Op> = Op extends { parameters: { query?: infer Query } } ? Query : never;

type SuccessStatusCode = 200 | 201 | 202 | 204;

/** União dos corpos de resposta 2xx de uma operação (`undefined` para as que respondem 204). */
export type SuccessResponseOf<Op> = Op extends { responses: infer Responses }
  ? {
      [Status in Extract<keyof Responses, SuccessStatusCode>]: Responses[Status] extends {
        content: { 'application/json': infer Body };
      }
        ? Body
        : undefined;
    }[Extract<keyof Responses, SuccessStatusCode>]
  : undefined;

type CallParams<Op> =
  PathParamsOf<Op> extends never
    ? { params?: { query?: QueryParamsOf<Op> } }
    : { params: { path: PathParamsOf<Op>; query?: QueryParamsOf<Op> } };

type CallBody<Op> =
  HasRequiredBody<Op> extends true ? { body: JsonBodyOf<Op> } : { body?: JsonBodyOf<Op> };

/** Opções de uma chamada tipada: `params`/`body` tornam-se obrigatórios quando a rota exige. */
export type CallOptions<Op> = CallParams<Op> &
  CallBody<Op> & {
    /** Cabeçalhos extras (ex.: `Idempotency-Key`); `Authorization`/`Accept`/`Content-Type` são automáticos. */
    headers?: Record<string, string>;
    signal?: AbortSignal;
  };

/**
 * Argumentos de uma chamada `request(path, method, …)`: o 3º argumento (`options`) só pode ser
 * omitido quando a rota não exige `params` nem `body` — do contrário o TypeScript obriga a informá-lo.
 */
export type RequestArgs<Path extends keyof paths, Method extends HttpMethod> =
  CallOptions<OperationAt<Path, Method>> extends { params: unknown } | { body: unknown }
    ? [options: CallOptions<OperationAt<Path, Method>>]
    : [options?: CallOptions<OperationAt<Path, Method>>];

/** Converte um valor de path/query param (string/number/boolean esperados) para texto, sem `[object Object]`. */
function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function buildPath(template: string, pathParams: Record<string, unknown> | undefined): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    const value = pathParams?.[key];
    if (value === undefined || value === null) {
      throw new Error(`@cube-track/sdk: parâmetro de path ausente \`${key}\` em \`${template}\``);
    }
    return encodeURIComponent(scalarToString(value));
  });
}

function appendQuery(path: string, query: Record<string, unknown> | undefined): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value as unknown[]) params.append(key, scalarToString(item));
      continue;
    }
    params.set(key, scalarToString(value));
  }
  const search = params.toString();
  return search === '' ? path : `${path}?${search}`;
}

async function problemOf(response: Response): Promise<ProblemDetails> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      const body = (await response.json()) as Partial<ProblemDetails>;
      return { ...body, status: response.status };
    } catch {
      return { status: response.status };
    }
  }
  return { status: response.status, detail: response.statusText };
}

export interface HttpClientOptions {
  /** URL base da API, com ou sem barra final (ex.: `https://api.cubetrack.example.com`). */
  baseUrl: string;
  /** Token de API `ctk_...` (pessoal ou de app OAuth) — enviado como `Authorization: Bearer`. */
  token: string;
  /** Implementação de `fetch` a usar; por padrão, `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/** Cliente HTTP tipado contra o OpenAPI gerado — a base sobre a qual `createClient()` é montado. */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpClientOptions) {
    if (options.baseUrl === '') throw new Error('@cube-track/sdk: `baseUrl` é obrigatório');
    if (options.token === '') throw new Error('@cube-track/sdk: `token` é obrigatório');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error(
        '@cube-track/sdk: `fetch` não está disponível neste runtime; informe `fetch` em createClient()',
      );
    }
    this.fetchImpl = fetchImpl;
  }

  /**
   * Escape hatch genérico: chama qualquer rota documentada em `docs/openapi.json` (veja `/v1/docs`)
   * com tipagem completa de path/query/corpo/resposta, mesmo sem um método de conveniência dedicado.
   */
  async request<Method extends HttpMethod, Path extends PathsWithMethod<Method>>(
    path: Path,
    method: Method,
    ...rest: RequestArgs<Path, Method>
  ): Promise<SuccessResponseOf<OperationAt<Path, Method>>> {
    const options = (rest[0] ?? {}) as CallOptions<OperationAt<Path, Method>>;
    const params = options.params as
      | { path?: Record<string, unknown>; query?: Record<string, unknown> }
      | undefined;
    const resolvedPath = appendQuery(buildPath(path, params?.path), params?.query);
    return this.send(
      resolvedPath,
      method,
      options.body,
      options.headers,
      options.signal,
    ) as Promise<SuccessResponseOf<OperationAt<Path, Method>>>;
  }

  private async send(
    path: string,
    method: string,
    body: unknown,
    headers: Record<string, string> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const finalHeaders: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.token}`,
      ...headers,
    };
    if (body !== undefined) finalHeaders['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: method.toUpperCase(),
        headers: finalHeaders,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new NetworkError(error instanceof Error ? error.message : 'network');
    }

    if (!response.ok) throw new ApiError(response.status, await problemOf(response));
    if (response.status === 204) return undefined;
    const contentType = response.headers.get('content-type') ?? '';
    return contentType.includes('json') ? await response.json() : undefined;
  }
}
