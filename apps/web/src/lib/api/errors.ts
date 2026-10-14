/** Erro da API no formato RFC 7807 (`application/problem+json`). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  code?: string;
  requestId?: string;
  errors?: { path: string; message: string; code?: string }[];
  retryAfter?: number;
  [key: string]: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${String(status)}`);
  }

  get code(): string {
    return this.problem.code ?? 'error';
  }

  /** Mensagens de validação por campo (`body.email` → `email`). */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const error of this.problem.errors ?? []) {
      const field = error.path.replace(/^(body|query|params)\./, '');
      result[field] ??= error.message;
    }
    return result;
  }
}

/** Falha de rede (sem resposta do servidor). */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}
