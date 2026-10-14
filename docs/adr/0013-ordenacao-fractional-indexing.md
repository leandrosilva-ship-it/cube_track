# ADR 0013 — Ordenação manual com fractional indexing

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto

Drag-and-drop de itens, grupos, colunas, views e cards Kanban deve ser instantâneo, colaborativo e não pode renumerar milhares de linhas.

## Decisão

- Posição como **string de fractional index** (base-62, algoritmo de Figma/`fractional-indexing`), com `COLLATE "C"`.
- Mover = calcular uma chave entre os vizinhos e atualizar **uma linha**.
- Colisões (dois clientes movendo para o mesmo lugar) desempatadas por `id`; rebalanceamento em background quando chaves passam de um tamanho limite.
- Implementação única em `packages/shared/src/fractional-index`, usada no cliente (otimista) e no servidor (validação).

## Alternativas consideradas

- **Inteiros com renumeração**: escritas em massa e conflitos.
- **Floats**: perdem precisão após muitas inserções no mesmo ponto.
- **Listas ligadas**: leitura ordenada cara.

## Consequências

- Kanban usa posição por item dentro da coluna/raia; ordenação manual da Tabela é independente da ordenação por coluna da view.
