import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

import { requireContext, type AuthPrincipal } from '../context/request-context.js';
import { UnauthorizedError } from '../errors/problems.js';
import { PUBLIC_METADATA } from '../http/endpoint.js';

/** Marca rota/resolver como público (sem access token). */
export const Public = () => SetMetadata(PUBLIC_METADATA, true);

/** Usuário autenticado da requisição. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): AuthPrincipal => {
    const principal = requireContext().principal;
    if (principal === null) throw new UnauthorizedError();
    return principal;
  },
);
