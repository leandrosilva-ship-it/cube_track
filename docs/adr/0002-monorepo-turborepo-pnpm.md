# ADR 0002 — Monorepo com Turborepo + pnpm

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
Frontend, API, gateway realtime e worker compartilham contratos (schemas Zod, eventos, tipos de coluna, permissões) e o schema do banco. Divergência de contratos entre front e back é uma das principais fontes de bug em produtos realtime.

## Decisão
- Monorepo **pnpm workspaces** + **Turborepo** (cache local/remoto de build, lint, typecheck e testes, execução por grafo de dependências).
- Apps: `apps/web`, `apps/api`, `apps/realtime`, `apps/worker`.
- Pacotes: `packages/db`, `packages/shared`, `packages/ui`, `packages/i18n`, `packages/config`, `packages/testing`, `packages/sdk`.
- Pacotes internos consumidos via TypeScript source (`"exports"` apontando para `src`) com `tsup` apenas onde for publicado (`sdk`).
- Versões de dependências comuns alinhadas via `pnpm` catalogs.
- Node.js LTS (22.x) fixado em `.nvmrc` e `engines`.

## Alternativas consideradas
- **Nx**: mais poderoso (geradores, boundaries), porém mais opinativo e pesado; Turborepo atende com menor custo cognitivo. Fronteiras entre pacotes serão garantidas por `eslint-plugin-boundaries`.
- **Polyrepo**: versionamento de contratos entre repos gera atrito e atrasos.

## Consequências
- CI usa `turbo run ... --filter=...[origin/main]` para rodar só o afetado.
- Um único PR pode alterar contrato + front + back de forma atômica.
