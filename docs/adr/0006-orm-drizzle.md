# ADR 0006 — ORM: Drizzle

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
O projeto depende intensamente de recursos específicos do PostgreSQL: RLS, `set_config` por transação, JSONB com operadores (`@>`, `jsonb_path_ops`), índices parciais/compostos, CTEs recursivas (pastas, dependências, caminho crítico), particionamento (auditoria, outbox) e SQL dinâmico seguro para o query builder de filtros.

## Decisão
Usar **Drizzle ORM** + **drizzle-kit** para migrações.

Motivos:
- Query builder SQL-like, totalmente tipado, com escape seguro para SQL bruto (`sql\`\``) — essencial para JSONB e filtros dinâmicos.
- Sem engine binária/processo extra; roda em Node puro (melhor cold start e footprint nos workers).
- Migrações em **SQL legível e versionado**, onde adicionamos manualmente políticas RLS, funções, triggers e partições.
- Transações explícitas fáceis de envolver com `TenantTransaction`.
- Funciona bem com PgBouncer (driver `pg`/`postgres.js`, sem prepared statements obrigatórios).

## Alternativas consideradas
- **Prisma**: excelente DX e ecossistema, mas RLS/`SET LOCAL` exige extensões de cliente e transações interativas; suporte a JSONB avançado e índices GIN/expressão é limitado no schema; SQL bruto perde tipagem; migrações customizadas mais trabalhosas.
- **Kysely**: ótimo query builder, mas sem schema declarativo/migrações geradas.
- **TypeORM/MikroORM**: Unit of Work completo, porém mais mágica e menos controle de SQL.

## Consequências
- Schema em `packages/db/src/schema`, migrações em `packages/db/migrations`.
- Repositórios na camada `infrastructure` mapeiam linhas ↔ entidades de domínio (o domínio não conhece Drizzle).
