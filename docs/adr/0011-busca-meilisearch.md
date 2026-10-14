# ADR 0011 — Busca global com Meilisearch

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto

Busca global (itens, atualizações, arquivos, boards, pessoas) com tolerância a erros de digitação, acentuação pt-BR, filtros por permissão e resposta < 100 ms.

## Decisão

- **Meilisearch**, índices por tipo de entidade (não por tenant), com atributo filtrável `tenant_id` e **tenant tokens** assinados pela API contendo filtros de tenant e de boards acessíveis.
- Indexação assíncrona pelo worker a partir dos eventos do outbox (atraso alvo < 2 s).
- Filtros de view dentro do board **não** usam o Meilisearch — usam PostgreSQL (ADR 0005); busca textual no board usa `pg_trgm` + `unaccent`.

## Alternativas consideradas

- **OpenSearch/Elasticsearch**: mais poderoso para analytics/logs, porém operação pesada; reconsiderar se surgirem requisitos de busca analítica ou volume muito alto.
- **Só PostgreSQL (FTS + pg_trgm)**: suficiente no board, fraco para busca global com relevância e typo tolerance.

## Consequências

- Mudanças de permissão afetam o token, não o índice (sem reindexação).
- Reindexação completa por tenant disponível como job administrativo.
