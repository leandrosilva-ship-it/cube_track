/**
 * Helpers puros do módulo de API pública (ADR 0056): tokens pessoais e apps OAuth
 * (`client_credentials`). Sem I/O — testável sem rede.
 *
 * `API_SCOPES` é uma cópia local da lista em `packages/shared/src/api-access.ts` (fonte da verdade):
 * aquele módulo também exporta `generateApiToken`/`hashApiToken`, que importam `node:crypto` no topo
 * do arquivo — inseguro para o bundle do navegador (o `package.json` do pacote só expõe esse caminho
 * via subpath `@cube-track/shared/api-access`, nunca pelo barrel `.`, exatamente para isolar esse
 * uso a código server-side). Mantemos a lista em sincronia manualmente; qualquer escopo novo lá
 * precisa ser espelhado aqui.
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
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Um escopo de escrita sempre implica a leitura correspondente (mesma regra do backend). */
const SCOPE_IMPLIES: Partial<Record<ApiScope, ApiScope[]>> = {
  'boards:write': ['boards:read'],
  'items:write': ['items:read'],
  'files:write': ['files:read'],
};

/** Alterna um escopo no conjunto selecionado; marcar um escopo de escrita também marca a leitura
 * implícita correspondente (evita um formulário que "esquece" de marcar a leitura). */
export function toggleScope(current: readonly string[], scope: ApiScope): string[] {
  if (current.includes(scope)) return current.filter((entry) => entry !== scope);
  const implied = SCOPE_IMPLIES[scope] ?? [];
  const next = new Set(current);
  next.add(scope);
  for (const entry of implied) next.add(entry);
  return [...next];
}

/** `expiresAt` nulo nunca expira; caso contrário, compara com o instante atual (injetável em teste). */
export function isExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (expiresAt === null) return false;
  return new Date(expiresAt).getTime() <= now;
}

/** Converte a data escolhida no formulário (`YYYY-MM-DD`, fim do dia) para um instante ISO com offset,
 * no formato que `CreateApiTokenBody.expiresAt` exige (`z.iso.datetime({ offset: true })`). */
export function endOfDayIso(dateOnly: string): string {
  return `${dateOnly}T23:59:59.999Z`;
}
