import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';

import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from './problems.js';

interface PgLikeError {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

function findPgError(error: unknown): PgLikeError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const candidate = current as PgLikeError;
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code))
      return candidate;
    current = candidate.cause;
  }
  return null;
}

/** Converte qualquer erro em `AppError` (desconhecidos viram 500 sem vazar detalhes). */
export function mapError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new ValidationError(
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 404) return new NotFoundError('Recurso', 'route_not_found');
    if (status === 413)
      return new AppError(413, 'payload_too_large', 'Conteúdo muito grande', error.message);
    return new AppError(status, `http_${status}`, error.name, error.message);
  }
  const pg = findPgError(error);
  if (pg !== null) {
    switch (pg.code) {
      case '23505':
        return new ConflictError('Já existe um registro com estes dados.', 'unique_violation', {
          constraint: pg.constraint,
        });
      case '23503':
        return new UnprocessableError(
          'Referência a registro inexistente ou de outra organização.',
          'reference_invalid',
          {
            constraint: pg.constraint,
          },
        );
      case '23514':
        return new UnprocessableError(
          'Os dados violam uma regra de integridade.',
          'check_violation',
          { constraint: pg.constraint },
        );
      case '42501':
        return new ForbiddenError('Operação não permitida.', 'row_security');
      case '22P02':
      case '22007':
      case '22008':
        return new ValidationError([{ path: '', message: 'Formato de valor inválido.' }]);
      case '40001':
      case '40P01':
        return new ConflictError(
          'Conflito de concorrência; tente novamente.',
          'serialization_failure',
        );
      default:
        break;
    }
  }
  return new AppError(500, 'internal_error', 'Erro interno', 'Ocorreu um erro inesperado.');
}
