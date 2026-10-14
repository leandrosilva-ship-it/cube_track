# ADR 0034 — Design system: tokens em TypeScript, Tailwind 4 CSS-first, Radix e Storybook

- **Status:** Aceita (detalha a ADR 0016)
- **Data:** 2026-10-14
- **Prompt:** 4

## Decisão

- **Tokens** em `packages/ui/src/tokens.ts`: marca, temas claro e escuro, paleta de 20 cores de status com cor de texto, raios, densidade e fontes.
  - `styles/tokens.css` espelha os tokens como variáveis `--ct-*` por `[data-theme]` e `[data-density]`. Um teste garante a igualdade com o `.ts`.
  - **Tailwind 4** consome as variáveis via `@theme inline` (`bg-surface`, `text-fg-muted`, `bg-primary-soft`…), com dark mode por `data-theme`.
- **Contraste verificado em teste:**
  - Textos sobre todas as superfícies ≥ 4,5:1.
  - Bordas de controles e foco ≥ 3:1.
  - Cores livres de status (escolhidas pelo usuário) passam por `accessiblePair()`, que ajusta a luminosidade até 4,5:1.
- **Componentes** sobre Radix (pacote `radix-ui`), cmdk, sonner e react-day-picker (pt-BR e es com a semana começando na segunda; en no domingo). Todos são Client Components (`'use client'`). O Storybook 10 (react-vite) documenta os componentes, com alternância de tema e densidade.
- **Densidade:** confortável ou compacta, via `data-density`, ajustando alturas de controles e linhas.
- **Preferências** (tema, densidade, painel recolhido) ficam no `localStorage`. Um script pré-pintura aplica tema e densidade antes da hidratação, sem flash.

## Alternativas consideradas

- **shadcn/ui copiado por app:** duplicaria componentes entre apps. Aqui o padrão shadcn vive uma única vez em `packages/ui`.
- **CSS-in-JS:** custo em runtime e incompatível com Server Components.

## Consequências

- Mudar uma cor exige editar `tokens.ts` e `tokens.css`; o teste aponta a divergência.
- A identidade visual está documentada em `docs/brand.md`.
