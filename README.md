# CUBE TRACK

Plataforma SaaS de gestão de projetos, processos e portfólio — colaborativa e em tempo real.

- Visão, princípios, stack e protocolo de trabalho: [`CLAUDE.md`](CLAUDE.md)
- Arquitetura: [`docs/architecture.md`](docs/architecture.md)
- Decisões (ADRs): [`docs/adr/`](docs/adr/README.md)
- Roadmap: [`docs/roadmap.md`](docs/roadmap.md)

## Início rápido

```bash
cp .env.example .env
pnpm install
pnpm infra:up      # PostgreSQL, Redis, MinIO, Meilisearch e Mailpit
pnpm db:migrate
pnpm db:seed       # tenant "Empresa Demo" com o board PMSP
pnpm test
```

Requisitos: Node.js 22, pnpm 10 e Docker (ou um PostgreSQL 16 apontado por `TEST_DATABASE_URL` para os testes).
Modelo de dados: [`docs/data-model.md`](docs/data-model.md).
