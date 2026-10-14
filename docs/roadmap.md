# CUBE TRACK — Roadmap

Legenda: ✅ concluído · 🟡 aguardando validação · ⏳ pendente · 🔄 em andamento

| #   | Prompt                                             | Status                  | Entregáveis principais                                                                                           | ADRs      |
| --- | -------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Visão do produto e arquitetura                     | ✅ Concluído            | `CLAUDE.md`, `docs/architecture.md`, ADRs 0001–0019, este roadmap                                                | 0001–0019 |
| 2   | Banco de dados e tabelas                           | 🟡 Aguardando validação | Monorepo, docker-compose, `packages/db` (88 tabelas + auditoria particionada), RLS, seed PMSP, testes, benchmark | 0020–0025 |
| 3   | Backend base                                       | ⏳                      | NestJS, tenant context, auth OIDC, Policy Engine, outbox, auditoria, docker-compose, realtime gateway            | —         |
| 4   | Frontend base                                      | ⏳                      | Next.js shell, design system, i18n, auth, navegação workspace/pastas, cliente realtime                           | —         |
| 5   | Boards, colunas e Tabela                           | ⏳                      | CRUD de boards/grupos/colunas/itens, ~30 tipos de coluna, Tabela virtualizada, edição inline realtime            | —         |
| 6   | Kanban e views salvas                              | ⏳                      | Kanban com raias, filtros/ordenação/agrupamento, views salvas e compartilhadas, link público                     | —         |
| 7   | Painel do item                                     | ⏳                      | Atualizações com @menções, respostas, reações, arquivos, log de atividade, subitens, Yjs                         | —         |
| 8   | Calendário, Timeline, Gantt e Formulários          | ⏳                      | Views de tempo, dependências, caminho crítico, baselines, formulários públicos                                   | —         |
| 9   | Dashboards                                         | ⏳                      | Widgets, agregações, Project Health, exportação                                                                  | —         |
| 10  | Automações, Processos e Notificações               | ⏳                      | Motor de regras, fases com SLA, workflows, inbox, e-mail                                                         | —         |
| 11  | Capacity e Timesheet                               | ⏳                      | Alocação, carga por pessoa, apontamento de horas, aprovações                                                     | —         |
| 12  | Portfólio                                          | ⏳                      | Programas, portfólios, scoring, rollups, visão executiva                                                         | —         |
| 13  | Contratos/OS/UST                                   | ⏳                      | Contratos, catálogo, OS, medição UST, faturamento                                                                | —         |
| 14  | IA                                                 | ⏳                      | Assistente, resumos, chatbot do board, sugestões                                                                 | —         |
| 15  | API pública, Integrações, Importadores e Templates | ⏳                      | API v1, webhooks, SDK, importador Monday/Jira/Trello/CSV, templates                                              | —         |
| 16  | Segurança, Performance, Testes e Deploy            | ⏳                      | Hardening, testes de carga, CI/CD, Helm, observabilidade, runbooks                                               | —         |

## Prompt 1 — Resumo

**Feito**

- Arquitetura de alto nível com diagramas Mermaid (componentes, fluxo de escrita, domínio).
- Estratégia de tempo real (rooms, envelope de eventos, otimismo, sequência por board, replay, LWW por campo + Yjs, reconexão, orçamento de latência).
- Estratégia de colunas customizáveis: JSONB + projeção tipada `item_field_index` (comparativo com EAV e tabelas dinâmicas).
- Multi-tenancy: schema compartilhado + `tenant_id` + RLS forçado, `set_config` local à transação, FKs compostas, papéis de banco.
- Estrutura completa do monorepo (inclui `apps/realtime`, justificado na ADR 0007).
- Modelo de domínio preliminar e mapeamento do caso PMSP (Monday → CUBE TRACK).
- 19 ADRs, `CLAUDE.md` com protocolo de trabalho e DoD.

**Pendências / dúvidas** — ver `docs/architecture.md` §7 (D1–D10). Nenhuma bloqueia o Prompt 2; confirmar premissas P2, P3 e P4.

**Como rodar e testar** — não se aplica (entrega documental, sem código de aplicação).

**Próximos passos** — Prompt 2: modelagem física do banco, migrações Drizzle, políticas RLS, testes de isolamento e benchmark de colunas customizadas.

## Prompt 2 — Resumo

**Feito**

- Monorepo Turborepo + pnpm (`packages/config`, `packages/shared`, `packages/db`), TypeScript strict, ESLint, Prettier, CI no GitHub Actions e `docker-compose` (PostgreSQL, Redis, MinIO, Meilisearch, Mailpit).
- `packages/shared`: UUIDv7, fractional indexing, registro de 32 tipos de coluna (schemas Zod de valor/configuração e projeção), formatador de ID com máscara.
- `packages/db`: 88 tabelas + `audit_logs` particionada, cobrindo todas as entidades do escopo (identidade, estrutura, customização, views, colaboração, planejamento, recursos, processos, automação, formulários, dashboards, portfólio, contratos e governança).
- 4 migrações: bootstrap (papéis, `app.uuid_v7`, contexto), schema (gerado), RLS/auditoria/triggers/funções e dados de referência (permissões e feriados 2024–2035).
- RLS forçado em todas as tabelas com tenant, FKs compostas, funções `SECURITY DEFINER` para fluxos sem tenant, auditoria append-only com hash encadeado, ID automático com máscara (`2026-0924`), projeção tipada por trigger, subitens limitados a 1 nível.
- Seed idempotente da Empresa Demo com o caso PMSP (60 demandas, 8 usuários + 1 convidado, contrato, catálogo do edital, OS, medições, views, formulário, link público, dashboard, automações, recursos, board ágil e de processo).
- 57 testes (18 unitários + 39 de integração), incluindo isolamento entre tenants com papel sem BYPASSRLS.
- Benchmark de 50 mil itens (`docs/data-model.md` §9) e `docs/data-model.md` com ER e descrição de cada entidade.
- ADRs 0020–0025.

**Pendências**

- Apps (`apps/api`, `apps/web`, `apps/realtime`, `apps/worker`) começam nos Prompts 3 e 4.
- Outbox transacional (`outbox_events`) e chaves de idempotência entram no Prompt 3, junto com a API.
- Keycloak, OpenTelemetry e Grafana entram no `docker-compose` no Prompt 3/16.
- Otimização da ordenação com cursor (31 ms) no Prompt 16.

**Como rodar e testar**

```bash
cp .env.example .env && pnpm install
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/db db:bench
```

**Próximos passos** — Prompt 3: backend base (NestJS, contexto de tenant por request, autenticação OIDC, Policy Engine, outbox, auditoria nos casos de uso e gateway realtime).
