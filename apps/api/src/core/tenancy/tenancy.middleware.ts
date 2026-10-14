import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { requireContext } from '../context/request-context.js';
import { mapError } from '../errors/map-error.js';
import { toProblem } from '../errors/problems.js';
import { TenantResolver } from './tenant-resolver.service.js';

/** Resolve o tenant da requisição (subdomínio ou header) e grava no contexto. */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(private readonly resolver: TenantResolver) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const header = request.headers['x-tenant'];
    const reference = this.resolver.reference(
      request.headers.host,
      typeof header === 'string' ? header : undefined,
    );
    if (reference === null) {
      next();
      return;
    }
    this.resolver
      .resolve(reference.ref, reference.source)
      .then((tenant) => {
        requireContext().tenant = tenant;
        next();
      })
      .catch((error: unknown) => {
        const problem = mapError(error);
        response
          .status(problem.status)
          .type('application/problem+json')
          .json(toProblem(problem, request.originalUrl, requireContext().requestId));
      });
  }
}
