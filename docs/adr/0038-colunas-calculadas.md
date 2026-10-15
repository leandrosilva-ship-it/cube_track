# ADR 0038 — Colunas calculadas: na transação ou no worker, conforme a dependência

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Contexto

Fórmula, Progresso, Espelho (lookup) e Rollup são somente leitura e precisam estar corretas em filtros, ordenação, exportação e tempo real. Algumas dependem só do próprio item; outras de subitens ou de itens relacionados (inclusive de outros boards).

## Decisão

- **Dependem só do item** (Fórmula e Progresso por colunas de status): calculadas pela API **na mesma transação** da escrita (`ComputedFieldsService` + `computeItemColumns`). O evento `item.updated` já leva os valores novos.
- **Dependem de outros itens** (Espelho, Rollup e Progresso por subitens): recalculadas pelo **worker** (fila `computed`) a partir dos eventos do outbox (`item.*`, `column.created/updated`). O worker encontra os dependentes (o próprio item, o pai e itens que apontam para ele por relação), grava valores, incrementa `fieldVersions` e emite `item.updated` — e reaplica as fórmulas do item.
- **Proteção contra laços:** cada job carrega `depth`; cadeias param em profundidade 5 (`MAX_COMPUTED_DEPTH`).
- **Voláteis:** fórmulas com `TODAY()`/`NOW()` são recalculadas por agendamento diário (00:05, America/Sao_Paulo), por board (`app.volatile_formula_boards()` SECURITY DEFINER lista os boards sem expor tenants).
- Valores calculados ficam no JSONB do item (`{ n | d | text, error?, computedAt }`) e são projetados em `item_field_index` como as demais colunas, permitindo filtrar e ordenar no servidor.

## Consequências

- Escritas continuam em uma transação; agregações entre itens são **eventualmente consistentes** (em geral, dezenas de milissegundos depois, via realtime).
- Criar uma coluna calculada recalcula o board inteiro em lotes de 500 no worker.
