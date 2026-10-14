# CUBE TRACK — Roadmap

Legenda: ✅ concluído · 🟡 aguardando validação · ⏳ pendente · 🔄 em andamento

| #   | Prompt                                             | Status                  | Entregáveis principais                                                                                                                                                                   | ADRs      |
| --- | -------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Visão do produto e arquitetura                     | ✅ Concluído            | `CLAUDE.md`, `docs/architecture.md`, ADRs 0001–0019, este roadmap                                                                                                                        | 0001–0019 |
| 2   | Banco de dados e tabelas                           | ✅ Concluído            | Monorepo, docker-compose, `packages/db` (88 tabelas + auditoria particionada), RLS, seed PMSP, testes, benchmark                                                                         | 0020–0025 |
| 3   | Backend base                                       | 🟡 Aguardando validação | `apps/api` (auth, multi-tenant, RBAC 5 níveis, REST/GraphQL, realtime, auditoria, arquivos, busca), `apps/worker`, `docs/permissions.md`, `docs/realtime-events.md`, `docs/openapi.json` | 0026–0030 |
| 4   | Frontend base                                      | ⏳                      | Next.js shell, design system, i18n, auth, navegação workspace/pastas, cliente realtime                                                                                                   | —         |
| 5   | Boards, colunas e Tabela                           | ⏳                      | CRUD de boards/grupos/colunas/itens, ~30 tipos de coluna, Tabela virtualizada, edição inline realtime                                                                                    | —         |
| 6   | Kanban e views salvas                              | ⏳                      | Kanban com raias, filtros/ordenação/agrupamento, views salvas e compartilhadas, link público                                                                                             | —         |
| 7   | Painel do item                                     | ⏳                      | Atualizações com @menções, respostas, reações, arquivos, log de atividade, subitens, Yjs                                                                                                 | —         |
| 8   | Calendário, Timeline, Gantt e Formulários          | ⏳                      | Views de tempo, dependências, caminho crítico, baselines, formulários públicos                                                                                                           | —         |
| 9   | Dashboards                                         | ⏳                      | Widgets, agregações, Project Health, exportação                                                                                                                                          | —         |
| 10  | Automações, Processos e Notificações               | ⏳                      | Motor de regras, fases com SLA, workflows, inbox, e-mail                                                                                                                                 | —         |
| 11  | Capacity e Timesheet                               | ⏳                      | Alocação, carga por pessoa, apontamento de horas, aprovações                                                                                                                             | —         |
| 12  | Portfólio                                          | ⏳                      | Programas, portfólios, scoring, rollups, visão executiva                                                                                                                                 | —         |
| 13  | Contratos/OS/UST                                   | ⏳                      | Contratos, catálogo, OS, medição UST, faturamento                                                                                                                                        | —         |
| 14  | IA                                                 | ⏳                      | Assistente, resumos, chatbot do board, sugestões                                                                                                                                         | —         |
| 15  | API pública, Integrações, Importadores e Templates | ⏳                      | API v1, webhooks, SDK, importador Monday/Jira/Trello/CSV, templates                                                                                                                      | —         |
| 16  | Segurança, Performance, Testes e Deploy            | ⏳                      | Hardening, testes de carga, CI/CD, Helm, observabilidade, runbooks                                                                                                                       | —         |

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

## Prompt 3 — Resumo

**Feito**

- **Autenticação** (ADR 0026):
  - e-mail/senha com Argon2id e bloqueio progressivo;
  - magic link;
  - OAuth Google/Microsoft com PKCE, nonce e JWKS;
  - access JWT de 10 min e refresh token rotativo com detecção de reuso por família;
  - MFA TOTP com códigos de recuperação;
  - recuperação de senha, verificação de e-mail e convites;
  - portas SAML/SCIM.
- **Multi-tenant:**
  - tenant resolvido por subdomínio ou `X-Tenant`, com conferência contra o token;
  - contexto `app.tenant_id` por transação (RLS);
  - troca de organização;
  - papéis `app_auth`/`app_relay` com RLS dedicada (ADR 0028).
- **RBAC em 5 níveis:**
  - `can(usuário, ação, recurso)` puro e testado, com cache Redis versionado;
  - papéis de sistema e customizados;
  - concessões em workspace, board, view e item;
  - restrição por coluna e escopo de itens para convidados (`docs/permissions.md`).
- **API:**
  - REST `/v1` com 47 rotas e GraphQL somente leitura;
  - validação Zod e paginação por cursor;
  - filtros (AST) e ordenação genéricos;
  - erros RFC 7807;
  - rate limiting, `Idempotency-Key`;
  - OpenAPI 3.1 gerado (`/v1/docs`, `docs/openapi.json`).
- **Tempo real:**
  - Socket.IO + Redis adapter com autenticação no handshake;
  - rooms por board, item, dashboard e usuário;
  - eventos tipados em `packages/shared`;
  - presença com heartbeat;
  - `seq` por board com replay e LWW por campo;
  - redação por destinatário (ADR 0027).
- **Auditoria:** toda rota mutável é auditada (o teste falha se faltar). A auditoria registra quem, o quê, antes/depois, IP e UA e entra na mesma transação que o log de atividade e o outbox.
- **Worker** (ADR 0029):
  - relay do outbox;
  - filas de e-mails, notificações, automações, cronograma, busca e antivírus;
  - retries exponenciais, dead-letter queue e Bull Board protegido;
  - health checks e encerramento gracioso.
- **Arquivos:**
  - upload por URL pré-assinada, com validação de tipo, tamanho e checksum;
  - antivírus plugável (ClamAV via clamd);
  - download bloqueado até a varredura limpa.
- **Busca:** Meilisearch para itens, boards e atualizações, com filtro por boards legíveis e escopo do convidado.
- **Observabilidade:**
  - OpenTelemetry (traces OTLP, métricas Prometheus);
  - pino com `requestId`/correlação;
  - `/health/live` e `/health/ready`.
- **Testes:** 203 passando, sendo 58 em `shared`, 39 em `db`, 77 em `api` e 29 em `worker`. Os critérios de aceite estão cobertos:
  - isolamento entre tenants;
  - propagação entre dois clientes com p95 de cerca de 64 ms (meta de 300 ms);
  - coluna sem permissão inacessível via REST, GraphQL e WS;
  - auditoria em toda mutação.

**Pendências**

- Implementações de SAML e SCIM (adaptadores das portas) e rotação de chaves JWT/criptografia: Prompt 16.
- Gatilhos de automação por data (`date_arrives`), SLA de fases e webhooks de saída: Prompt 10.
- Colaboração Yjs/Hocuspocus em rich text: Prompt 7.
- Os testes usam s3rver (S3 fake) e um clamd falso. MinIO e ClamAV reais estão no `docker-compose` (`--profile antivirus`).
- Cenários k6 de 50 mil itens: Prompt 16.
- Itens do DoD de UI (responsivo, teclado) passam a valer com o frontend (Prompt 4).

**Como rodar e testar**

```bash
cp .env.example .env && pnpm install
pnpm infra:up                     # Postgres, Redis, MinIO, Meilisearch, Mailpit (ClamAV: docker compose --profile antivirus up -d)
pnpm db:migrate && pnpm db:seed   # login demo: ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm build
pnpm --filter @cube-track/api start      # http://localhost:3001/v1/docs (header X-Tenant: empresa-demo)
pnpm --filter @cube-track/worker start   # Bull Board: http://localhost:3010/admin/queues
pnpm lint && pnpm typecheck && pnpm test
```

**Próximos passos:** Prompt 4, frontend base (Next.js, design system, i18n, fluxos de autenticação, navegação e cliente realtime com patches no TanStack Query).
