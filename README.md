# CUBE PROJECT

Plataforma SaaS multi-tenant de gestão de **projetos, processos e portfólio** — colaborativa e em
tempo real, do operacional (boards, itens, Kanban) ao estratégico (programas, portfólio, rollups).
Combina, numa única fonte de dados, o que hoje exige várias ferramentas (Monday.com, Trello, Jira,
Pipefy, MS Project, PPM) — com um módulo opcional de Contratos/OS/UST para consultorias que atendem
órgãos públicos.

- Visão, princípios, stack e protocolo de trabalho: [`CLAUDE.md`](CLAUDE.md)
- Arquitetura: [`docs/architecture.md`](docs/architecture.md) · Modelo de dados: [`docs/data-model.md`](docs/data-model.md)
- Decisões técnicas (ADRs): [`docs/adr/`](docs/adr/README.md)
- **Status do desenvolvimento (16 prompts) e relatório final**: [`docs/roadmap.md`](docs/roadmap.md), [`docs/relatorio-final.md`](docs/relatorio-final.md)
- Segurança (ISO/IEC 27001, OWASP) e LGPD: [`docs/security.md`](docs/security.md), [`docs/lgpd.md`](docs/lgpd.md)
- Deploy e operação: [`docs/deploy.md`](docs/deploy.md), runbooks em [`docs/runbooks/`](docs/runbooks)

## Stack

Turborepo + pnpm · Next.js (App Router) + TanStack Query/Table/Virtual + dnd-kit + ECharts · NestJS
(Clean Architecture/DDD) · PostgreSQL 16 (RLS por tenant) + Drizzle ORM · Redis (cache/pub-sub/
presença) · Socket.IO (tempo real) + Yjs/Hocuspocus (edição colaborativa) · BullMQ (filas) · S3/MinIO
· Meilisearch · OpenTelemetry/Prometheus/Grafana/Sentry. Detalhe completo e justificativa de cada
escolha (ADRs) em [`docs/architecture.md`](docs/architecture.md) §3.

## Estrutura do monorepo

```
apps/web        Next.js (UI)
apps/api        NestJS — REST (OpenAPI) + GraphQL leitura + gateway Socket.IO
apps/worker     BullMQ — outbox relay, e-mails, notificações, automações, cronograma, busca, antivírus
packages/db     Schema Drizzle, migrações SQL, políticas RLS, seeds
packages/shared Contratos (Zod), tipos de domínio, eventos, registro de tipos de coluna
packages/ui     Design system (shadcn/ui + componentes CUBE PROJECT)
packages/config ESLint, Prettier, tsconfig, Tailwind preset
packages/i18n   Mensagens pt-BR/en/es, formatadores, feriados
packages/sdk    SDK TypeScript gerado a partir do OpenAPI
packages/testing Utilitários de teste (banco isolado por execução, papéis sem BYPASSRLS)
docs/           Arquitetura, ADRs, roadmap, segurança, LGPD, deploy, runbooks
infra/          docker, helm, observabilidade, scripts
tools/load/     Testes de carga k6 (lista de itens, propagação realtime)
```

## Início rápido

```bash
cp .env.example .env
pnpm install
pnpm infra:up      # PostgreSQL, Redis, MinIO, Meilisearch e Mailpit
pnpm db:migrate
pnpm db:seed       # tenant "Empresa Demo" com o board PMSP
pnpm test
```

Requisitos: Node.js 22, pnpm 10 e Docker (ou um PostgreSQL 16 nativo + Redis, apontados por
`TEST_DATABASE_URL`/`.env`, para rodar sem Docker).

Rodando tudo:

```bash
pnpm build
pnpm --filter @cube-track/api dev      # API em :3001 (OpenAPI em /v1/docs)
pnpm --filter @cube-track/worker dev   # worker + Bull Board em :3010/admin/queues
pnpm --filter @cube-track/web dev      # web em :3000 (proxy /v1 -> API)
```

Login de demonstração (seed padrão): `ana.ribeiro@empresademo.com.br` / `CubeTrack@2026`.

Outros comandos úteis (lista completa em [`CLAUDE.md`](CLAUDE.md) §4):

```bash
pnpm db:seed:large                      # board "Carga — 50 mil itens", para testes de performance/E2E
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e  # Playwright (fluxos críticos, dois navegadores, axe)
pnpm load:items && pnpm load:realtime   # k6 — ver tools/load/README.md
```

## Estado do desenvolvimento

Os 16 prompts do protocolo de trabalho (`CLAUDE.md` §6/§7) estão concluídos — detalhe completo de
cada entrega, pendências conhecidas e como testar em [`docs/roadmap.md`](docs/roadmap.md). Um
resumo executivo do que foi entregue, a cobertura de testes real medida, os resultados de carga e
os riscos/backlog remanescentes estão em [`docs/relatorio-final.md`](docs/relatorio-final.md).
