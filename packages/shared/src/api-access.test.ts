import { describe, expect, it } from 'vitest';

import { expandScopes, generateApiToken, hasScope, hashApiToken, looksLikeApiToken } from './api-access.js';

describe('generateApiToken', () => {
  it('gera um token com o prefixo fixo e um hash que bate com o próprio token', () => {
    const { token, displayPrefix, tokenHash } = generateApiToken();
    expect(token.startsWith('ctk_')).toBe(true);
    expect(displayPrefix).toBe(token.slice(0, 12));
    expect(tokenHash).toBe(hashApiToken(token));
  });

  it('nunca gera o mesmo token duas vezes', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).not.toBe(b.token);
  });
});

describe('looksLikeApiToken', () => {
  it('reconhece um token pelo prefixo e tamanho mínimo', () => {
    expect(looksLikeApiToken(generateApiToken().token)).toBe(true);
    expect(looksLikeApiToken('ctk_curto')).toBe(false);
    expect(looksLikeApiToken('sk-outro-formato-qualquer')).toBe(false);
  });
});

describe('expandScopes/hasScope', () => {
  it('um escopo de escrita implica o de leitura correspondente', () => {
    const expanded = expandScopes(['boards:write']);
    expect(expanded.has('boards:write')).toBe(true);
    expect(expanded.has('boards:read')).toBe(true);
  });

  it('hasScope nega um escopo não concedido nem implícito', () => {
    expect(hasScope(['items:read'], 'items:write')).toBe(false);
    expect(hasScope(['items:write'], 'items:read')).toBe(true);
  });
});
