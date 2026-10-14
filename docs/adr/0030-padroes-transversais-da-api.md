# ADR 0030 — Padrões transversais da API: unidade de trabalho, idempotência, rate limit e build

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 3

## Decisão

- **Unidade de trabalho:** `TransactionRunner` com AsyncLocalStorage.
  - Toda rota mutável é marcada com `@Audited` (o teste `api.e2e.test.ts` percorre todas as rotas e falha se faltar).
  - A transação grava auditoria, atividade e outbox juntas. Hooks _after-commit_ invalidam cache e publicam eventos.
  - POSTs de consulta usam `@ReadOnlyOperation`.
- **Idempotência:**
  - O header `Idempotency-Key` em POST é guardado no Redis por 24 h, com chave por tenant, usuário e rota, junto com o hash do corpo.
  - Uma repetição devolve a mesma resposta. Corpo diferente responde 422. Uma requisição ainda em andamento responde 409.
- **Rate limiting:**
  - Janela fixa atômica (script Lua no Redis), por usuário, IP ou IP + e-mail (rotas de autenticação).
  - Responde 429 `problem+json` com `Retry-After` e cabeçalhos `RateLimit-*`.
- **Erros:** RFC 7807 com `code` estável, `requestId` e `errors[]` de validação. Erros do PostgreSQL são mapeados (23505 → 409, 23503 e 23514 → 422, 42501 → 403; recurso invisível por RLS → 404).
- **Contrato:**
  - Schemas Zod em `@Endpoint` geram o OpenAPI 3.1 em `/v1/openapi.json`, `/docs` e `docs/openapi.json`, este último verificado no CI.
  - O GraphQL code-first é somente leitura.
- **Build:** apps NestJS e worker usam **tsup + SWC**, que preserva o _decorator metadata_ e empacota os pacotes `@cube-track/*` (código-fonte, ADR 0025). Dependências de terceiros ficam externas.

## Alternativas consideradas

- **`nest build` (tsc):** não resolve pacotes internos publicados como `.ts`.
- **Idempotência em tabela do PostgreSQL:** mais durável, mas pesa no caminho crítico. O Redis com AOF é suficiente para a janela de 24 h.
