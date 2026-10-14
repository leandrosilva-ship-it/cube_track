# ADR 0028 — Papéis `app_auth` e `app_relay` com políticas RLS dedicadas

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 3

## Contexto

Dois fluxos acessam dados **antes** de haver um tenant no contexto, ou **entre** tenants:

1. **Autenticação:** login, refresh, convites e OAuth leem `users`, `memberships`, `sessions` etc. sem conhecer o tenant.
2. **Relay do outbox:** lê eventos pendentes de todos os tenants.

Usar `BYPASSRLS` não funciona como esperado, porque o atributo **não é herdado** por membros de um papel de grupo. Além disso, liberaria todas as tabelas.

## Decisão

- Papéis de grupo `NOLOGIN NOBYPASSRLS`:
  - `app_auth`: recebe `GRANT` apenas nas tabelas de identidade e políticas `CREATE POLICY auth_service … TO app_auth USING (true)` nessas tabelas;
  - `app_relay`: recebe `SELECT/UPDATE/DELETE` apenas em `outbox_events`, com a política `relay_service TO app_relay`.
- **Logins separados**, um por conexão:
  - `DATABASE_AUTH_URL` (API, conexão `AUTH_DB`);
  - `DATABASE_RELAY_URL` (worker).
- `app.resolve_tenant(ref)` (SECURITY DEFINER) resolve o tenant por slug ou id usando só comparação textual, sem cast que falhe.
- O restante da aplicação continua com `app_rw` e o contexto `withTenant`.

## Alternativas consideradas

- **Funções SECURITY DEFINER para cada consulta de autenticação:** rígido e difícil de manter.
- **Um único papel com BYPASSRLS:** não é herdado e quebraria o isolamento.

## Consequências

- O teste `infra.e2e.test.ts` (worker) confirma que o papel do relay não lê tabelas de negócio. Os testes de autenticação usam o papel real.
- Ambientes precisam criar os logins `cubetrack_auth` e `cubetrack_relay` (`infra/docker/postgres/init/01-roles.sql`, Helm no Prompt 16).
