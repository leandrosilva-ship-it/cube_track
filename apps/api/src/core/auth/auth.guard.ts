import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { requireContext } from '../context/request-context.js';
import { ForbiddenError, UnauthorizedError } from '../errors/problems.js';
import { PUBLIC_METADATA } from '../http/endpoint.js';
import { httpPair } from '../http/execution.js';
import { TokenService } from './token.service.js';

export function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token !== undefined && token.length > 0
    ? token
    : null;
}

/**
 * Guard global: valida o access token e garante que o tenant do token é o mesmo resolvido pelo
 * subdomínio/header (quando presente). Rotas públicas aceitam token opcional.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const pair = httpPair(context);
    if (pair === null) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    const token = extractBearer(pair.request.headers.authorization);
    const store = requireContext();
    if (token === null) {
      if (isPublic) return true;
      throw new UnauthorizedError();
    }
    const verified = await this.tokens.verifyAccessToken(token);
    if (store.tenant !== null && store.tenant.tenantId !== verified.principal.tenantId) {
      throw new ForbiddenError('O token pertence a outra organização.', 'tenant_mismatch');
    }
    store.principal = verified.principal;
    return true;
  }
}
