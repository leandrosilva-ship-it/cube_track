# ADR 0033 — Cliente de dados e realtime: chaves padronizadas, patches no cache e reconciliação

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 4

## Contexto

A mesma fonte de dados alimenta várias views (princípio 2) e precisa refletir mudanças de outros usuários em menos de 300 ms. Isso exige:

- mutações otimistas;
- ordem garantida dos eventos;
- recuperação após quedas de conexão.

## Decisão

- **Chaves do TanStack Query padronizadas** (`src/lib/query/keys.ts`). Tudo de um board fica sob `['boards', id]` (detalhe, views, listas de itens por parâmetros), de modo que uma única invalidação faz o _resync_ completo.
- **Mutações otimistas:**
  - Cada mutação gera um `clientMutationId` (header `X-Client-Mutation-Id`) e uma `Idempotency-Key` nos POST.
  - O patch é aplicado no cache em `onMutate`.
  - Erro desfaz o patch.
  - Um 409 (conflito LWW) aplica o valor atual do servidor e avisa o usuário.
  - O eco realtime de uma mutação ainda pendente é ignorado, porque a resposta HTTP é a confirmação.
- **Eventos aplicados como patches puros** (`realtime/apply.ts`):
  - LWW por campo com `fieldVersions` (ADR 0008): só uma versão maior vence.
  - Inserções vão para as listas sem filtro.
  - Listas filtradas ou ordenadas são invalidadas, porque só o servidor sabe se o item entra nelas.
- **Ordem e recuperação** (`realtime/client.ts`):
  - Uma conexão Socket.IO por aba, carregada sob demanda. O token é obtido a cada (re)conexão.
  - Backoff de 1 a 30 s com jitter.
  - Assinaturas de board com contagem de referências.
  - A base de `seq` vem do GET do board.
  - Uma lacuna dispara `GET /v1/boards/:id/events?after=` e os eventos são aplicados em ordem. Se o replay é impossível (`resyncRequired`), o board é invalidado.
  - Eventos duplicados são descartados pelo `eventId`.
- **Presença:** heartbeat a cada 10 s, com estado (view aberta) atualizado na hora. A entrada e a saída de usuários aparecem no cabeçalho do board.

## Alternativas consideradas

- **Refetch a cada evento:** simples, mas gera tempestade de requisições em boards movimentados e não cumpre p95 < 300 ms.
- **Store normalizado próprio (Redux/entidades):** duplicaria o cache do Query.

## Consequências

- `apply.ts` e `client.ts` têm testes unitários: LWW, eco, lacuna/replay, resync, presença e cancelamento.
- Os E2E com dois navegadores validam presença e propagação.
