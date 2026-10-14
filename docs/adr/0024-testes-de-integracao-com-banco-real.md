# ADR 0024 — Testes de integração com PostgreSQL real e papéis sem BYPASSRLS

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 2

## Contexto

RLS, triggers, partições e funções `SECURITY DEFINER` só podem ser validados num PostgreSQL real. Testes executados como superusuário passariam mesmo com políticas quebradas, porque superusuários ignoram RLS.

## Decisão

- O _global setup_ do Vitest cria um **banco isolado por execução**, aplica as migrações como dono e cria papéis de login **sem BYPASSRLS** (`app_rw`, `app_ro`); os testes de negócio usam esses papéis.
- Servidor: `TEST_DATABASE_URL` (CI usa um _service container_ PostgreSQL 16) ou, se ausente, **Testcontainers** (`postgres:16-alpine`).
- O próprio **seed roda com o papel da aplicação** nos testes — prova que o caminho normal funciona sob RLS.
- Teste-guardião: falha se qualquer tabela com `tenant_id` não tiver RLS habilitado, forçado e com política.
- A CI também executa `drizzle-kit check`, `db:reset` e `db:seed` como smoke test.

## Alternativas consideradas

- **pg-mem / SQLite**: não suportam RLS, triggers PL/pgSQL nem particionamento.
- **Mocks de repositório**: não testam o isolamento.

## Consequências

- Testes de integração exigem PostgreSQL ou Docker localmente (documentado em `docs/data-model.md`).
