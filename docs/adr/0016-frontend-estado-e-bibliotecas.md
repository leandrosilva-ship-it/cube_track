# ADR 0016 — Frontend: Next.js App Router, estado e bibliotecas de UI

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
A UI é altamente interativa (grid virtualizado com 50k linhas, Kanban, Gantt, edição inline), colaborativa e localizada.

## Decisão
- **Next.js (App Router)** com rotas `[locale]`; Server Components para shell, layout e páginas estáticas; Client Components para áreas interativas. Sem lógica de negócio no BFF.
- **TanStack Query** = estado de servidor; eventos realtime aplicam patches normalizados no cache; mutações otimistas com rollback.
- **Zustand** = estado de UI (seleção, painel aberto, edição de célula, preferências locais).
- **TanStack Table + TanStack Virtual** para Tabela (virtualização de linhas e colunas); **dnd-kit** para drag-and-drop (acessível por teclado).
- **TailwindCSS + shadcn/ui** (Radix) em `packages/ui`; tokens de design com tema claro/escuro.
- **ECharts** para dashboards (performático com muitos pontos, suporte a canvas, temas, acessibilidade via aria/decal). Recharts descartado por desempenho com séries grandes.
- **Gantt/Timeline** próprio sobre SVG + virtualização (bibliotecas prontas não cobrem baselines + caminho crítico + realtime com licença compatível).
- **Tiptap** (ProseMirror) + Yjs para rich text.
- **next-intl** para i18n; formatação via `Intl` e `date-fns` + `date-fns-tz`.
- Formulários com **react-hook-form + Zod** (mesmos schemas do backend).

## Alternativas consideradas
- **AG Grid**: excelente, mas licença enterprise para recursos-chave e customização visual limitada.
- **Redux Toolkit**: mais cerimônia que Zustand + Query para este caso.
- **Recharts**: SVG puro, degrada com muitos pontos.

## Consequências
- `packages/ui` concentra DataGrid, KanbanBoard, Gantt, editores de célula e é testado isoladamente (Storybook + testes de acessibilidade com axe).
