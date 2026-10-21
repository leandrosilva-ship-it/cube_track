# ADR 0046 — Transições controladas na coluna de status

- **Status:** Aceita
- **Data:** 2026-10-16
- **Prompt:** 6

## Contexto

O Kanban (e processos em geral) às vezes precisam de um fluxo de trabalho controlado: por exemplo, impedir que um item pule direto de "Não iniciado" para "Concluído" sem passar por "Em andamento". Isso só faz sentido em colunas do tipo `status` (rótulo único) e precisa ser **opcional** — a maioria das colunas de status não tem regra nenhuma.

## Decisão

- `column_definitions.settings.transitions`, para colunas `status`: mapa `{ [rótuloOrigemId]: [rótuloDestinoId, ...] }`, até 50 destinos por origem (mesmo schema Zod `labelSettings` que já valida `defaultLabelId`).
- `isTransitionAllowed(transitions, fromLabelId, toLabelId)` (`packages/shared/src/columns/registry.ts`), função pura:
  - sem mapa configurado, ou rótulo de origem ausente do mapa → **permitido** (opt-in: boards antigos e rótulos sem regra continuam livres);
  - `fromLabelId` ou `toLabelId` nulo (criação do item, ou esvaziar o campo) → **sempre permitido** (a regra só vale entre dois rótulos conhecidos, numa edição).
- Imposta no servidor em `item-writer.ts`, no mesmo laço que já calcula o valor anterior/novo de cada coluna: para colunas `status` cujo rótulo mudou, valida a transição e responde `422 invalid_transition` (com `columnKey`, `fromLabelId`, `toLabelId`) antes de gravar.
- O Kanban vai bloquear visualmente o drag-and-drop inválido (ou mostrar o erro do servidor); a Tabela e a API pública continuam sujeitas à mesma regra por já passarem pelo mesmo `item-writer`.

## Consequências

- Nenhuma migração: `settings` já era `jsonb` livre por tipo de coluna.
- Ativar a regra num board existente nunca invalida itens já parados num rótulo sem transição de saída configurada — eles continuam editáveis livremente até alguém adicionar uma regra para aquele rótulo especificamente.
- A regra vale em qualquer superfície de escrita (Tabela, Kanban, importação, API pública de escrita futura) porque está no caso de uso de atualização do item, não numa tela específica.
