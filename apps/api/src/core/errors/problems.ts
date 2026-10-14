/**
 * Erros de aplicação mapeados para RFC 7807 (application/problem+json).
 * `code` é estável e documentado; `type` é a URL de documentação do problema.
 */
export const PROBLEM_BASE_URL = 'https://docs.cubetrack.com.br/problems/';

export interface ProblemIssue {
  path: string;
  message: string;
  code?: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
    this.name = new.target.name;
  }

  get detail(): string {
    return this.message;
  }
}

export class ValidationError extends AppError {
  constructor(
    readonly issues: ProblemIssue[],
    detail = 'A requisição contém dados inválidos.',
  ) {
    super(400, 'validation_failed', 'Dados inválidos', detail, { errors: issues });
  }
}

export class UnauthorizedError extends AppError {
  constructor(code = 'unauthenticated', detail = 'Autenticação necessária.') {
    super(401, code, 'Não autenticado', detail);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    detail = 'Você não tem permissão para esta ação.',
    code = 'forbidden',
    extensions: Record<string, unknown> = {},
  ) {
    super(403, code, 'Acesso negado', detail, extensions);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, code = 'not_found') {
    super(404, code, 'Não encontrado', `${entity} não encontrado(a).`);
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, code = 'conflict', extensions: Record<string, unknown> = {}) {
    super(409, code, 'Conflito', detail, extensions);
  }
}

export class UnprocessableError extends AppError {
  constructor(detail: string, code = 'unprocessable', extensions: Record<string, unknown> = {}) {
    super(422, code, 'Não processável', detail, extensions);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(detail: string) {
    super(413, 'payload_too_large', 'Conteúdo muito grande', detail);
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      429,
      'rate_limited',
      'Muitas requisições',
      'Limite de requisições excedido. Tente novamente em instantes.',
      {
        retryAfter: retryAfterSeconds,
      },
    );
  }
}

export class NotImplementedError extends AppError {
  constructor(detail: string) {
    super(501, 'not_implemented', 'Não implementado', detail);
  }
}

export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance?: string;
  requestId?: string;
  [extension: string]: unknown;
}

export function toProblem(error: AppError, instance?: string, requestId?: string): ProblemDocument {
  return {
    type: `${PROBLEM_BASE_URL}${error.code}`,
    title: error.title,
    status: error.status,
    detail: error.detail,
    code: error.code,
    ...(instance === undefined ? {} : { instance }),
    ...(requestId === undefined ? {} : { requestId }),
    ...error.extensions,
  };
}
