# ADR 0031 — Frontend: Next.js 16 com webpack, next-intl com root params e mensagens em TypeScript

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 4

## Contexto

`apps/web` consome os pacotes internos (`@cube-track/ui`, `shared`, `i18n`) como código-fonte TypeScript (ADR 0025). Esses pacotes usam imports `./x.js` (NodeNext), exigidos pela API e pelo worker. O idioma padrão é pt-BR, com en/es, e precisa de URLs limpas para o idioma padrão.

## Decisão

- **Next.js 16 (App Router) com webpack** (`next dev --webpack`, `next build --webpack`).
  - O Turbopack ainda não resolve `./x.js` para `./x.ts`.
  - No webpack, `resolve.extensionAlias` (`.js → .ts/.tsx/.js`) resolve isso.
  - `transpilePackages` cobre os pacotes internos.
  - `optimizePackageImports` cobre `lucide-react`, `@cube-track/ui` e `@cube-track/i18n`, para importar só os módulos usados dos barrels.
- **Subpaths sem Zod em `@cube-track/shared`:**
  - `@cube-track/shared/realtime` (rooms e constantes de presença) e `@cube-track/shared/fractional-index` existem para que o bundle do navegador não carregue os schemas Zod de eventos.
  - O pacote declara `"sideEffects": false`.
- **next-intl 4** com `localePrefix: 'as-needed'`:
  - pt-BR fica sem prefixo; en e es usam `/en` e `/es`.
  - O idioma é lembrado no cookie `ct_locale`. `src/proxy.ts` é o middleware do Next 16.
  - O idioma da requisição vem de `next/root-params`, sem `setRequestLocale`. As páginas públicas são pré-renderizadas (SSG) por idioma.
  - Ao digitar `/pt-BR/...` com o cookie já definido em outro idioma, vale o cookie. A troca explícita pelo seletor de idioma atualiza o cookie.
- **Mensagens em TypeScript** (`packages/i18n/src/messages/*.ts`):
  - pt-BR é a fonte e define o tipo `Messages`; en e es precisam satisfazê-lo.
  - Um teste de paridade compara as chaves e os argumentos ICU dos três idiomas.
  - Formatação via `Intl`, com datas de negócio em UTC e dinheiro e UST como decimal string (ADR 0019).
- **Formulários:** react-hook-form com `zod/mini` (a API funcional mantém o bundle das telas públicas pequeno), usando o resolver oficial.

## Alternativas consideradas

- **Turbopack:** exigiria trocar todos os imports dos pacotes internos para extensionless, o que quebra a resolução NodeNext da API.
- **Prefixo de idioma sempre (`/pt-BR/...`):** URLs mais longas para a maioria dos usuários, sem ganho real.
- **Mensagens em JSON:** sem checagem de tipos nas chaves e nos argumentos.

## Consequências

- Builds um pouco mais lentos que com Turbopack. Revisar quando o Turbopack suportar `extensionAlias`.
- O cookie de idioma prevalece sobre o prefixo digitado, comportamento documentado em `docs/frontend-guidelines.md`.
