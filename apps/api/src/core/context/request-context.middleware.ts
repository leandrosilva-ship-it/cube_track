import { Injectable, type NestMiddleware } from '@nestjs/common';
import { newId } from '@cube-track/shared';
import type { NextFunction, Request, Response } from 'express';

import { createContextStore, runWithContext } from './request-context.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Abre o contexto (AsyncLocalStorage) da requisição com correlation id, IP e user agent. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.headers['x-request-id'];
    const requestId =
      typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : newId();
    response.setHeader('X-Request-Id', requestId);
    const clientMutation = request.headers['x-client-mutation-id'];
    const store = createContextStore({
      requestId,
      ip: request.ip ?? null,
      userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
      clientMutationId: typeof clientMutation === 'string' ? clientMutation.slice(0, 64) : null,
    });
    runWithContext(store, () => {
      next();
    });
  }
}
