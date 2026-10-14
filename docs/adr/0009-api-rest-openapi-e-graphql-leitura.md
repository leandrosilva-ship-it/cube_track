# ADR 0009 — API: REST (OpenAPI) para comandos e API pública + GraphQL para leituras compostas

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
A stack sugere REST + GraphQL. Precisamos definir o papel de cada um para não duplicar regras nem superfícies de segurança.

## Decisão
- **REST** (NestJS + OpenAPI 3.1 gerado a partir de schemas Zod) é o **contrato principal**: todos os comandos (escritas), consultas de board/itens paginadas por cursor e a **API pública versionada** (`/api/v1`). Erros em RFC 7807. Idempotência via header `Idempotency-Key`.
- **GraphQL** (code-first, Apollo/Mercurius no Nest) **somente leitura**, para composições profundas: dashboards, portfólio, painel do item (item + updates + arquivos + atividade + dependências), "Meu trabalho". DataLoader obrigatório; limites de profundidade/complexidade; persisted queries em produção.
- Ambas as superfícies usam os mesmos casos de uso da camada `application` e o mesmo Policy Engine.
- Webhooks de saída assinados (HMAC) com retentativas (Prompt 15).

## Alternativas consideradas
- **Só GraphQL** (inclusive mutations): integrações de órgãos públicos e ferramentas no-code consomem REST com mais facilidade; caching HTTP e rate limit por rota mais simples.
- **Só REST**: telas compostas fariam muitas chamadas ou exigiriam endpoints ad-hoc.
- **tRPC**: ótimo para TS ponta a ponta, mas não serve como API pública.

## Consequências
- Mutations GraphQL não existem; o cliente web escreve via REST.
- SDK TypeScript gerado da especificação OpenAPI (`packages/sdk`).
