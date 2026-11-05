# Runbook — pool de conexões do PostgreSQL esgotado / suspeita de RLS mal configurado

## Sintomas

- `/health/ready` retorna `checks.postgres.status: "down"` (timeout de 2s no `select 1`, ver
  `apps/api/src/core/observability/health.controller.ts`).
- Erros no log da api/worker: `too many clients already`, `remaining connection slots are
  reserved`, ou timeouts de `pg.Pool` (`apps/api/src/core/database/database.module.ts`, limite
  por processo em `DATABASE_POOL_MAX`).
- **Sintoma distinto de RLS mal configurado:** erros `permission denied for table <tabela>` ou
  consultas retornando **zero linhas** quando deveriam retornar dados de um tenant que existe —
  nesse caso não é esgotamento de pool, é contexto de tenant ausente/errado (ver passo 3).

## Diagnóstico

1. **Conexões ativas vs. limite do servidor:**
   ```sql
   select count(*), state from pg_stat_activity group by state;
   select setting from pg_settings where name = 'max_connections';
   ```
   Se `count(*)` está perto de `max_connections`, é esgotamento real. Compare com
   `DATABASE_POOL_MAX` (padrão 20 no `.env.example`) × número de réplicas de api/worker: com
   `api.replicaCount=3` e `worker.replicaCount=3` e `DATABASE_POOL_MAX=20`, o teto teórico já é
   120 conexões só da aplicação — confira se o Postgres gerenciado comporta isso (RDS/Cloud SQL
   têm `max_connections` baseado no tamanho da instância).

2. **Quem está seguraando conexões por muito tempo:**
   ```sql
   select pid, now() - query_start as duration, state, left(query, 120)
   from pg_stat_activity
   where state != 'idle'
   order by duration desc
   limit 20;
   ```
   Uma query de automação/rollup (ver `apps/worker/src/processors`) rodando minutos → candidata a
   travar/otimizar. Muitas conexões em `idle in transaction` → transação aberta sem commit/rollback
   num caso de erro não tratado — procurar no código por um `withTenant`/`db.transaction` sem
   `try/finally` correto no caminho que gerou o erro.

3. **Suspeita de RLS mal configurado (não é esgotamento):**
   - Confirme que o código está passando pelo papel certo: `DATABASE_APP_URL` (papel `app_rw`,
     sem BYPASSRLS — ADR 0024/0028) para operação normal, nunca `DATABASE_URL` (dono do schema,
     com BYPASSRLS) fora de migração/seed.
   - Confirme que a chamada passou por `withTenant(db, { tenantId, userId }, tx => ...)`
     (`packages/db/src/client.ts`) — qualquer acesso fora disso não tem `app.tenant_id` setado e o
     RLS nega ou filtra tudo, por design.
   - Teste manual do contexto:
     ```sql
     select app.set_context('<tenant-uuid>'::uuid, '<user-uuid>'::uuid);
     select count(*) from items; -- deve retornar só linhas do tenant
     ```
   - Se uma tabela nova foi criada sem `select app.enable_tenant_rls('public.<tabela>')` na
     migração (ver CLAUDE.md §4 "Regras do banco"), ela fica sem RLS nenhum — **mais grave que
     esgotamento**: dados de um tenant ficam visíveis para outro. Trate como incidente de
     segurança (`docs/runbooks/incidente-seguranca.md`) além de corrigir a migração.

## Remediação

- **Esgotamento transitório de pico de tráfego:** `kubectl -n cube-track scale deployment/cube-track-api --replicas=<N-1>`
  reduz temporariamente o número de pools de aplicação (menos pools = menos conexões) enquanto se
  decide se o `max_connections` do Postgres gerenciado precisa subir, ou se `DATABASE_POOL_MAX`
  precisa descer no `values-<ambiente>.yaml`.
- **Query/transação presa:** `select pg_terminate_backend(<pid>);` no `pid` identificado no passo
  2, só depois de confirmar que não é uma migração em andamento.
- **RLS ausente numa tabela:** aplicar uma migração `--custom` imediata com
  `select app.enable_tenant_rls('public.<tabela>');` — nunca editar a migração antiga que criou a
  tabela (CLAUDE.md: "Nunca edite migrações já aplicadas em ambientes compartilhados").
- **Considerar um pooler externo** (PgBouncer em modo transaction, já citado no código) se o
  número de réplicas crescer além do que o Postgres gerenciado aguenta em conexões diretas — isso
  é uma mudança de infraestrutura fora do escopo deste chart, registrar como ADR se adotado.

## Prevenção

- Alerta `CubeTrackPostgresConnectionsHigh` (ver `infra/observability/prometheus/alerts.yml`)
  dispara antes de esgotar de vez.
- Toda tabela nova com `tenant_id` usa `tenantTable()` e a migração correspondente roda
  `enable_tenant_rls` — isso é revisão de PR obrigatória (checklist de pronto, CLAUDE.md §4/§6).
- Testes de integração rodam com papéis **sem BYPASSRLS** (ADR 0024,
  `packages/testing/src/database.ts`) — um teste que vaza dados entre tenants deveria já falhar
  antes de chegar em produção.
