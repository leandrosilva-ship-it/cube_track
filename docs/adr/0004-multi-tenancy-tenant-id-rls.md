# ADR 0004 — Multi-tenancy com schema compartilhado, `tenant_id` e Row Level Security

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto

SaaS com centenas de tenants, de pequenos a órgãos públicos com requisitos de isolamento fortes. Um vazamento entre tenants é o pior incidente possível (LGPD, ISO 27001). Ao mesmo tempo, schema por tenant ou banco por tenant multiplica migrações e conexões.

## Decisão

- **Banco e schema compartilhados**, coluna `tenant_id uuid not null` em todas as tabelas de negócio.
- **RLS habilitado e forçado** (`ENABLE` + `FORCE ROW LEVEL SECURITY`) com políticas `USING` e `WITH CHECK` comparando `tenant_id` a `current_setting('app.tenant_id', true)::uuid`. Sem contexto ⇒ nenhuma linha (_fail closed_).
- Contexto definido por transação com `set_config('app.tenant_id', $1, true)` (LOCAL), compatível com **PgBouncer em modo transaction**.
- **PK e FKs compostas** `(tenant_id, id)` para impedir referências cruzadas.
- Papéis de banco separados: `migrator` (dono das tabelas), `app_rw` e `app_ro` (sem `BYPASSRLS`), `platform_admin` (BYPASSRLS, uso auditado).
- `TenantContext` via AsyncLocalStorage na API, no realtime e no worker; acesso ao banco só por `TenantTransaction`.
- Isolamento estendido a Redis (prefixos), S3 (prefixos), Meilisearch (tenant tokens), filas (tenantId no job) e rooms realtime.
- Evolução para **cells**: tenants grandes/governo podem ser alocados em cluster dedicado com o mesmo schema, via diretório tenant → cell.

## Alternativas consideradas

- **Schema por tenant**: migrações N vezes, catálogo do PostgreSQL inchado, pooling ruim.
- **Banco por tenant**: isolamento máximo, mas custo e operação inviáveis para tenants pequenos — mantido como opção via cells.
- **Só filtro na aplicação**: um `WHERE` esquecido vaza dados; RLS é defesa em profundidade.

## Consequências

- Testes de integração obrigatórios de isolamento para cada tabela nova.
- Índices sempre iniciam por `tenant_id` ou por uma chave já escopada (ex.: `board_id`).
- Tabelas globais (catálogo de feriados nacionais, planos) explicitamente sem RLS e somente leitura para `app_rw`.
- RLS cobre **isolamento de tenant**; permissões finas ficam no Policy Engine da aplicação.
