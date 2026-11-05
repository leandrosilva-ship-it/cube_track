import { createHash, randomBytes } from 'node:crypto';

/**
 * API pública (Prompt 15, ADR 0056): tokens pessoais e apps OAuth (client credentials) compartilham
 * o mesmo vocabulário de escopos — um escopo é uma permissão adicional de TETO sobre a requisição,
 * nunca um substituto do RBAC: uma requisição autenticada por token só pode fazer o que (a) o escopo
 * do token permite E (b) o usuário/app dono do token poderia fazer via `AccessService` normalmente.
 * Só módulos de leitura/escrita amplamente úteis via API entram no catálogo — não há escopo para
 * ações administrativas sensíveis (gestão de membros, papéis, configuração de IA), que continuam
 * exigindo sessão autenticada normal.
 */

export const API_SCOPES = [
  'boards:read',
  'boards:write',
  'items:read',
  'items:write',
  'automations:manage',
  'webhooks:manage',
  'templates:manage',
  'files:read',
  'files:write',
  /** Provisionamento SCIM 2.0 (ADR 0057) — cobre `members.invite`/`members.manage` SÓ para o token,
   * nunca substitui o RBAC normal: o usuário/app dono do token precisa já ter essas permissões
   * (ceiling, ver `api-scope-map.ts`). Não dá acesso a papéis/times além do que SCIM provisiona. */
  'scim:manage',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Um escopo de escrita sempre inclui a leitura correspondente — evita exigir os dois no cadastro. */
const SCOPE_IMPLIES: Partial<Record<ApiScope, ApiScope[]>> = {
  'boards:write': ['boards:read'],
  'items:write': ['items:read'],
  'files:write': ['files:read'],
};

/** Expande a lista de escopos concedidos com o que cada um implica (closure transitiva simples). */
export function expandScopes(scopes: readonly ApiScope[]): Set<ApiScope> {
  const expanded = new Set<ApiScope>(scopes);
  for (const scope of scopes) for (const implied of SCOPE_IMPLIES[scope] ?? []) expanded.add(implied);
  return expanded;
}

export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  return expandScopes(granted).has(required);
}

export const API_TOKEN_PREFIX = 'ctk_';
const SECRET_BYTES = 32;

export interface GeneratedApiToken {
  /** Valor completo mostrado ao usuário UMA vez — nunca persistido em texto puro. */
  token: string;
  /** Primeiros 12 caracteres (incluindo o prefixo) — exibido depois para identificar o token na lista. */
  displayPrefix: string;
  /** SHA-256 hex do token completo — o único valor persistido, comparado a cada requisição. */
  tokenHash: string;
}

/** Gera um novo token pessoal/de app: aleatório, com prefixo fixo para reconhecimento visual/scanners. */
export function generateApiToken(): GeneratedApiToken {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const token = `${API_TOKEN_PREFIX}${secret}`;
  return { token, displayPrefix: token.slice(0, 12), tokenHash: hashApiToken(token) };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Reconhece a forma de um token antes de ir ao banco — evita hash de lixo claramente não-token. */
export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX) && value.length >= API_TOKEN_PREFIX.length + 16;
}
