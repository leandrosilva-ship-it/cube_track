import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GraphQLError } from 'graphql';

import { currentContext } from '../context/request-context.js';
import { mapError } from './map-error.js';
import { RateLimitError, toProblem } from './problems.js';

/** Filtro global: responde erros como RFC 7807 (HTTP) ou GraphQLError com a mesma estrutura. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): unknown {
    const error = mapError(exception);
    const requestId = currentContext()?.requestId;
    if (error.status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Erro não tratado');
    }
    const type = host.getType<'http' | 'graphql' | 'ws'>();
    if (type === 'graphql') {
      return new GraphQLError(error.detail, {
        extensions: {
          code: error.code,
          status: error.status,
          problem: toProblem(error, undefined, requestId),
        },
      });
    }
    if (type !== 'http') return error;
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    if (error instanceof RateLimitError)
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    response
      .status(error.status)
      .type('application/problem+json')
      .json(toProblem(error, request.originalUrl, requestId));
    return undefined;
  }
}
