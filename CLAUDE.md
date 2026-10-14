# CUBE TRACK — Guia do Projeto

> Leia este arquivo, `docs/architecture.md`, `docs/roadmap.md` e todas as ADRs em `docs/adr/` **antes de começar qualquer trabalho**.

## 1. Visão do produto

**CUBE TRACK** é uma plataforma web SaaS, multi-tenant, de gestão de **projetos, processos e portfólio**, colaborativa e em tempo real, usada pelo time inteiro: gestores, PMO, executores e clientes convidados.

Combina, numa única fonte de dados:

| Referência          | O que trazemos                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| Monday.com          | Boards, grupos e colunas customizáveis; múltiplas views do mesmo dado        |
| Trello              | Kanban simples e fluido, drag-and-drop instantâneo                           |
| Jira                | Sprints, backlog, tipos de item, workflows com transições controladas        |
| Pipefy              | Processos por fases, formulários por fase, SLA, campos obrigatórios por fase |
| MS Project          | Cronograma com dependências (FS/SS/FF/SF + lag), caminho crítico, baselines  |
| PPM (Planview etc.) | Portfólio, programas, priorização (scoring), capacity e rollups              |

Caso de referência: consultoria que atende órgãos públicos com contratos medidos em **UST**. O módulo **Contratos/OS/UST** é **opcional por workspace** — o núcleo é genérico e multissetor.

## 2. Princípios de produto (inegociáveis)

1. **Tudo configurável sem código** — colunas, status, views, automações, formulários, dashboards e workflows.
2. **Uma fonte de dados, múltiplas visões** sempre sincronizadas.
3. **Tempo real por padrão** — propagação p95 < 300 ms entre clientes.
4. **Do operacional ao estratégico** — item → projeto → programa → portfólio, com rollup automático.
5. **Performance** — boards com 50 mil itens fluidos (virtualização, paginação por cursor, filtros no servidor).
6. **Segurança e governança** — LGPD, auditoria completa, controles alinhados à ISO 27001.
7. **pt-BR por padrão**, i18n (en, es), formatos e feriados brasileiros.

## 3. Stack

| Camada                 | Tecnologia                                                                                                                        | ADR        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Monorepo               | Turborepo + pnpm workspaces                                                                                                       | 0002       |
| Frontend               | Next.js (App Router), React, TypeScript, TailwindCSS + shadcn/ui, TanStack Query/Table/Virtual, dnd-kit, Zustand, ECharts, Tiptap | 0016       |
| Backend                | Node.js + NestJS (monólito modular, Clean Architecture/DDD)                                                                       | 0003       |
| API                    | REST (OpenAPI) como contrato principal e público + GraphQL somente leitura para agregações                                        | 0009       |
| Tempo real             | Socket.IO + Redis adapter (módulo `realtime` da API, deploy separado com `REALTIME_MODE=separate`), Yjs via Hocuspocus            | 0007, 0027 |
| Banco                  | PostgreSQL 16+ com `tenant_id` + RLS; valores customizados em JSONB + projeção tipada                                             | 0004, 0005 |
| ORM                    | **Drizzle ORM** + drizzle-kit                                                                                                     | 0006       |
| Cache/pub-sub/presença | Redis 7                                                                                                                           | 0007       |
| Filas                  | BullMQ + outbox transacional                                                                                                      | 0012       |
| Arquivos               | S3 compatível (MinIO em dev)                                                                                                      | —          |
| Busca                  | Meilisearch (tenant tokens)                                                                                                       | 0011       |
| Identidade             | Auth nativa na API (senha Argon2id, magic link, OAuth Google/Microsoft, TOTP); portas SAML/SCIM                                   | 0026       |
| Infra                  | Docker, docker-compose, Kubernetes (Helm), GitHub Actions                                                                         | 0018       |
| Observabilidade        | OpenTelemetry, Prometheus/Grafana, Sentry, logs estruturados (pino)                                                               | 0018       |

## 4. Estrutura do monorepo (resumo)

```
apps/web        Next.js (UI)
apps/api        NestJS (REST + GraphQL, regras de negócio) + gateway Socket.IO (main.realtime)
apps/worker     BullMQ (outbox relay, e-mails, notificações, automações, cronograma, busca, antivírus) + Bull Board
packages/db     Schema Drizzle, migrações SQL, políticas RLS, seeds
packages/shared Contratos (Zod), tipos de domínio, eventos, registro de tipos de coluna
packages/ui     Design system (shadcn/ui + componentes CUBE TRACK)
packages/config ESLint, Prettier, tsconfig, Tailwind preset
packages/i18n   Mensagens pt-BR/en/es, formatadores, feriados
packages/testing Utilitários de teste (banco isolado por execução, papéis sem BYPASSRLS)
docs/           Arquitetura, ADRs, roadmap
infra/          docker, helm, observabilidade
```

Estrutura completa em `docs/architecture.md` §5. Modelo de dados em `docs/data-model.md`. Frontend: `docs/frontend-guidelines.md` e `docs/brand.md`.

### Comandos

```bash
cp .env.example .env && pnpm install
pnpm infra:up                     # PostgreSQL, Redis, MinIO, Meilisearch, Mailpit (docker compose)
pnpm db:migrate | db:seed | db:reset
pnpm build                        # tsup + SWC (api, worker)
pnpm --filter @cube-track/api dev     # API em :3001 (OpenAPI em /v1/docs)
pnpm --filter @cube-track/worker dev  # worker + Bull Board em :3010/admin/queues
pnpm --filter @cube-track/web dev     # web em :3000 (Next.js + webpack; API via proxy /v1)
pnpm --filter @cube-track/ui storybook # design system em :6006
pnpm --filter @cube-track/web test:e2e # Playwright (banco demo: db:reset && db:seed)
pnpm --filter @cube-track/web lighthouse # performance/acessibilidade das telas base
pnpm --filter @cube-track/api openapi:export   # atualiza docs/openapi.json (após build)
pnpm lint && pnpm typecheck && pnpm test
pnpm format                       # Prettier
```

### Regras do banco (packages/db)

- Todo acesso a dados de negócio passa por `withTenant(db, { tenantId, userId }, tx => ...)`.
- Tabela nova com `tenant_id`: use `tenantTable()` (adiciona colunas padrão e `UNIQUE (tenant_id, id)`), FKs com `tenantFk()` e, na migração, `select app.enable_tenant_rls('public.<tabela>')`.
- Mudou o schema → `pnpm db:generate`; SQL manual (RLS, funções, triggers) → migração `--custom`. Nunca edite migrações já aplicadas em ambientes compartilhados.
- Auditoria via `appendAuditLog(tx, ...)` na mesma transação da mudança.

## 5. Convenções de código

### Gerais

- **TypeScript `strict: true`** (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Proibido `any` implícito; `any` explícito só com comentário justificando.
- **ESLint + Prettier** compartilhados via `packages/config`. CI falha com warnings.
- **Validação na borda com Zod**; schemas vivem em `packages/shared` e são reutilizados no front e no back.
- Nomes de código, tabelas e APIs em **inglês**; textos de UI apenas via i18n (chaves), nunca hardcoded.
- **IDs UUIDv7** (ADR 0014). Datas/horas em UTC (`timestamptz`); datas de negócio (prazo, término) como `date` sem fuso.
- Dinheiro e UST como `numeric` / decimal string — nunca `float`.
- Sem TODOs, placeholders ou código morto em entregas.

### Backend (NestJS)

- Monólito modular: um módulo por _bounded context_ em `apps/api/src/modules/<context>/` com camadas:
  - `domain/` — entidades, value objects, eventos de domínio, regras puras (sem Nest, sem Drizzle);
  - `application/` — casos de uso (commands/queries), portas (interfaces);
  - `infrastructure/` — repositórios Drizzle, adaptadores (S3, Redis, Meilisearch);
  - `presentation/` — controllers REST, resolvers GraphQL, DTOs.
- Dependências apontam para dentro. Um módulo só acessa outro pela sua API pública (`application`) ou por eventos.
- Toda escrita roda em transação com contexto de tenant (`SET LOCAL app.tenant_id`) e grava **outbox** + **auditoria** na mesma transação.
- Erros de domínio tipados → mapeados para RFC 7807 (`application/problem+json`).

### Frontend (Next.js)

- App Router; Server Components para shell/SEO, Client Components para áreas interativas.
- Estado de servidor: TanStack Query. Estado de UI efêmero: Zustand. Eventos realtime aplicam _patches_ no cache do Query.
- Componentes reutilizáveis em `packages/ui`; nada de estilo ad-hoc repetido.
- Acessibilidade: navegação por teclado completa, foco visível, ARIA correto, contraste WCAG 2.1 AA (e eMAG quando aplicável).
- Responsivo: mobile-first a partir de 360 px.

### Git

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `ci:`), escopo opcional (`feat(api): ...`).
- Branches curtas; PR com descrição, testes e checklist de pronto.

### Testes

- Unitários: Vitest (domínio e utilitários; front com Testing Library).
- Integração: Vitest com PostgreSQL real (`TEST_DATABASE_URL` ou Testcontainers) e papéis **sem BYPASSRLS** (ADR 0024).
- E2E: Playwright, incluindo cenários com **dois navegadores** simultâneos para validar tempo real.
- Carga: k6 para os cenários de 50 mil itens e propagação < 300 ms.

## 6. Protocolo de trabalho (seguir em TODOS os prompts)

1. Ler `CLAUDE.md`, `docs/architecture.md`, `docs/roadmap.md` e as ADRs antes de começar.
2. Código completo nas partes entregues, **sem TODOs ou placeholders**.
3. TypeScript `strict`, ESLint + Prettier, Clean Architecture/DDD no backend, componentes reutilizáveis no frontend, commits convencionais.
4. Testes em cada entrega (unitários, integração e E2E dos fluxos críticos).
5. Ao final de cada prompt: atualizar `docs/roadmap.md`, registrar ADRs novas e apresentar resumo (**feito, pendências, como rodar e testar, próximos passos**).
6. Em caso de ambiguidade: escolher a opção mais alinhada às melhores práticas, **registrar em ADR e seguir**. Perguntar apenas o que bloqueia.
7. Aguardar validação do usuário ao final de cada prompt antes de iniciar o próximo.

### Definição de pronto (DoD)

Uma funcionalidade só está pronta quando:

- [ ] funciona em **tempo real entre dois navegadores**;
- [ ] **respeita permissões** (tenant, workspace, board, coluna, convidado);
- [ ] tem **testes passando** (unit, integração, E2E do fluxo crítico);
- [ ] é **responsiva**;
- [ ] é **acessível por teclado**;
- [ ] **registra auditoria**;
- [ ] está **documentada** (docs/ADR/roadmap atualizados).

## 7. Roadmap de prompts

| #   | Tema                                               |
| --- | -------------------------------------------------- |
| 1   | Arquitetura                                        |
| 2   | Banco de dados e tabelas                           |
| 3   | Backend base                                       |
| 4   | Frontend base                                      |
| 5   | Boards, colunas e Tabela                           |
| 6   | Kanban e views salvas                              |
| 7   | Painel do item                                     |
| 8   | Calendário, Timeline, Gantt e Formulários          |
| 9   | Dashboards                                         |
| 10  | Automações, Processos e Notificações               |
| 11  | Capacity e Timesheet                               |
| 12  | Portfólio                                          |
| 13  | Contratos/OS/UST                                   |
| 14  | IA                                                 |
| 15  | API pública, Integrações, Importadores e Templates |
| 16  | Segurança, Performance, Testes e Deploy            |

Status atualizado em `docs/roadmap.md`.
