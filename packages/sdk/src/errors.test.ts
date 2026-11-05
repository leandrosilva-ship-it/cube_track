import { describe, expect, it } from 'vitest';

import { ApiError, isApiError } from './errors.js';

describe('ApiError', () => {
  it('usa `detail` do RFC 7807 como mensagem, quando presente', () => {
    const error = new ApiError(404, {
      status: 404,
      type: 'https://cubetrack.example.com/problems/not-found',
      title: 'Não encontrado',
      detail: 'Token não encontrado',
      code: 'token_not_found',
    });

    expect(error.message).toBe('Token não encontrado');
    expect(error.status).toBe(404);
    expect(error.code).toBe('token_not_found');
    expect(error.name).toBe('ApiError');
  });

  it('cai para `title`, depois para `HTTP <status>`, quando faltam campos', () => {
    const withTitleOnly = new ApiError(403, { status: 403, title: 'Acesso negado' });
    expect(withTitleOnly.message).toBe('Acesso negado');

    const withNeither = new ApiError(500, { status: 500 });
    expect(withNeither.message).toBe('HTTP 500');
    expect(withNeither.code).toBe('error');
  });

  it('extrai erros de validação por campo via `fieldErrors()`', () => {
    const error = new ApiError(400, {
      status: 400,
      errors: [
        { path: 'body.name', message: 'Obrigatório' },
        { path: 'body.scopes', message: 'Selecione ao menos um escopo' },
        { path: 'query.limit', message: 'Deve ser positivo' },
      ],
    });

    expect(error.fieldErrors()).toEqual({
      name: 'Obrigatório',
      scopes: 'Selecione ao menos um escopo',
      limit: 'Deve ser positivo',
    });
  });

  it('isApiError() reconhece o tipo e, opcionalmente, o status', () => {
    const error = new ApiError(401, { status: 401 });
    expect(isApiError(error)).toBe(true);
    expect(isApiError(error, 401)).toBe(true);
    expect(isApiError(error, 403)).toBe(false);
    expect(isApiError(new Error('outro erro'))).toBe(false);
  });
});
