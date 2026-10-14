# ADR 0023 — Usuários e catálogos globais; funções SECURITY DEFINER para fluxos sem tenant

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 2

## Contexto

A premissa P2 (usuário em vários tenants) torna `users` uma tabela global. Alguns fluxos ocorrem antes de existir contexto de tenant: login (listar organizações do usuário), links públicos, formulários públicos e criação de usuário por convite. Catálogos como permissões, feriados oficiais e templates da plataforma também são globais.

## Decisão

- `users` é global, com RLS **sem FORCE**: a aplicação vê o próprio usuário e quem tem membership no tenant corrente; atualiza só o próprio perfil; **não insere nem exclui** (exclusão = anonimização LGPD).
- `permissions` é catálogo global somente leitura (carregado por migração).
- `holidays` e `templates` aceitam `tenant_id` nulo (global): leitura de globais + do tenant; escrita somente do tenant.
- Fluxos sem contexto usam funções **`SECURITY DEFINER`** com `search_path` fixo, pertencentes ao papel `platform_admin` (BYPASSRLS), retornando o mínimo necessário: `app.ensure_user`, `app.user_tenants`, `app.resolve_share_link`, `app.resolve_public_form`.
- O migrator precisa ser membro de `platform_admin` (a migração faz o `GRANT` quando possível e falha com instrução clara caso contrário); `platform_admin` tem `CREATE` no schema `app` para ser dono das funções.

## Alternativas consideradas

- **Usuário por tenant**: duplicaria identidades e quebraria SSO/troca de organização.
- **Conexão BYPASSRLS na API para esses fluxos**: amplia demais a superfície privilegiada.

## Consequências

- Toda nova função definer precisa de revisão de segurança (parâmetros, retorno mínimo, `search_path`).
- Testes cobrem a resolução de links sem contexto e o bloqueio de inserção direta em `users`.
