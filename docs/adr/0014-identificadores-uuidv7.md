# ADR 0014 — Identificadores UUIDv7

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
IDs são gerados no cliente (updates otimistas), no servidor e em importações; precisam ser globalmente únicos, não enumeráveis e amigáveis a índices B-tree.

## Decisão
- **UUIDv7** (ordenado por tempo) como PK de todas as entidades, gerado na aplicação (`packages/shared`); o cliente pode propor o id na criação otimista (validado pelo servidor).
- Identificadores legíveis por humanos quando necessário (ex.: `PMSP-142`, número de OS) são campos separados, sequenciais por escopo.
- Colunas customizadas usam ids curtos estáveis (`c_` + nanoid) dentro do board, pois são chaves do JSONB.

## Alternativas consideradas
- **bigserial**: enumerável, exige round-trip para criar.
- **UUIDv4**: fragmenta índices.
- **ULID/CUID2**: equivalentes, mas UUIDv7 tem tipo nativo `uuid` no PostgreSQL.

## Consequências
- Cursores de paginação podem usar o id como desempate natural.
