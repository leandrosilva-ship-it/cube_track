import type { components } from './generated/schema.js';

/**
 * Erro da API pública no formato RFC 7807 (`application/problem+json`), conforme CLAUDE.md §5
 * ("Erros de domínio tipados → mapeados para RFC 7807"). O schema gerado (`components['schemas']['Problem']`)
 * marca os campos como obrigatórios, mas um corpo de erro real (ex.: vindo de um proxy, de um 5xx não
 * tratado, ou de uma resposta sem `application/problem+json`) nem sempre os traz todos — só `status`
 * é garantido aqui (sempre preenchido com o HTTP status da resposta), o resto é tratado como opcional.
 */
export type ProblemDetails = Partial<components['schemas']['Problem']> & { status: number };

/** Erro lançado para toda resposta HTTP não-2xx do cliente. */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly problem: ProblemDetails,
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${String(status)}`);
  }

  /** Código de erro de domínio (`problem.code`), ou `'error'` quando a API não informou um. */
  get code(): string {
    return this.problem.code ?? 'error';
  }

  /** Mensagens de validação por campo (`body.email` → `email`), quando a API retornou `errors`. */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const error of this.problem.errors ?? []) {
      const field = error.path.replace(/^(body|query|params)\./, '');
      result[field] ??= error.message;
    }
    return result;
  }
}

/** Falha de rede (sem resposta do servidor) — distinta de `ApiError`, que exige uma resposta HTTP. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}
