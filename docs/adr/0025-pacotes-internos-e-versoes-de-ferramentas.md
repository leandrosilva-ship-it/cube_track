# ADR 0025 — Pacotes internos via código-fonte e linha de versões das ferramentas

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 2

## Contexto

Ao inicializar o monorepo foi preciso escolher como os pacotes internos são consumidos e quais versões de ferramentas fixar. Havia versões majoritárias muito recentes disponíveis (TypeScript 7 nativo, ESLint 10, Vitest 5, Zod 4.6), ainda sem suporte consolidado no ecossistema (typescript-eslint, drizzle-kit, Next.js, NestJS).

## Decisão

- Pacotes internos (`@cube-track/shared`, `@cube-track/db`, `@cube-track/config`) exportam **código-fonte TypeScript** (`exports` → `src/index.ts`), sem etapa de build; `tsx`, Vitest e (nos próximos prompts) Next.js/Nest transpilam. Só pacotes publicados (`sdk`) terão build.
- Linha de versões estável e compatível entre si: **Node 22 LTS, pnpm 10, TypeScript 5.9, ESLint 9 + typescript-eslint 8, Prettier 3, Vitest 3, Zod 4.1, Drizzle ORM 0.45 + drizzle-kit 0.31, Turborepo 2.5**.
- Atualizações majoritárias serão feitas em PRs dedicados, com ADR quando mudarem convenções.

## Alternativas consideradas

- **Build de cada pacote (tsup)**: mais lento no desenvolvimento e exige _watch_ encadeado.
- **Adotar as majors mais novas**: risco de incompatibilidade com o restante da stack.

## Consequências

- `tsconfig` com `moduleResolution: NodeNext` e imports relativos com extensão `.js`.
- O lockfile (`pnpm-lock.yaml`) fixa as versões exatas.
