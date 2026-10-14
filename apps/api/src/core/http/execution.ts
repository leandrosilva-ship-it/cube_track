import type { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request, Response } from 'express';

/** Obtém request/response tanto em HTTP quanto em GraphQL. */
export function httpPair(
  context: ExecutionContext,
): { request: Request; response: Response } | null {
  const type = context.getType<'http' | 'graphql' | 'ws'>();
  if (type === 'http') {
    return {
      request: context.switchToHttp().getRequest<Request>(),
      response: context.switchToHttp().getResponse<Response>(),
    };
  }
  if (type === 'graphql') {
    const gql = GqlExecutionContext.create(context).getContext<{ req: Request; res: Response }>();
    return { request: gql.req, response: gql.res };
  }
  return null;
}

export function isGraphql(context: ExecutionContext): boolean {
  return context.getType<'http' | 'graphql'>() === 'graphql';
}
