# ADR 0020 — Projeção tipada (`item_field_index`) mantida por trigger no banco

- **Status:** Aceita (refina a ADR 0005)
- **Data:** 2026-10-14
- **Prompt:** 2

## Contexto

A ADR 0005 previu que a projeção tipada dos valores customizados seria mantida pelo repositório da aplicação na mesma transação. Ao implementar o modelo, vimos que itens também são gravados por importadores, automações (worker), seeds e, no futuro, por SQL administrativo. Qualquer caminho que esquecer de atualizar a projeção deixa filtros e ordenação inconsistentes — um defeito silencioso.

## Decisão

- A projeção é mantida por **triggers `AFTER INSERT` / `AFTER UPDATE OF values, board_id`** em `items` (`app.items_project_values`), na mesma transação.
- A regra de extração por tipo (`app.project_value`) espelha `projection` do registro de tipos (`packages/shared/src/columns/registry.ts`); testes de integração verificam o comportamento.
- `app.reproject_board(board_id)` reprocessa um board inteiro (criação de coluna, mudança de tipo) — executado pelo worker.
- A aplicação tem **somente leitura** em `item_field_index`; o trigger roda como `SECURITY DEFINER` (dono `platform_admin`) e filtra explicitamente por `tenant_id`.
- Colunas vinculadas (`binding`) e multivaloradas (pessoas, tags, dropdown) não são projetadas: usam campos nativos ou o índice GIN.

## Alternativas consideradas

- **Manter na aplicação** (ADR 0005 original): menos lógica no banco, mas frágil diante de múltiplos escritores.
- **Colunas geradas / índices de expressão**: exigiriam DDL por coluna customizada.

## Consequências

- Escrita de item custa um `DELETE` + `INSERT` na projeção apenas quando `values` muda (cláusula `WHEN`).
- Novos tipos de coluna exigem atualizar `app.project_value` e o registro TypeScript juntos (mesmo PR).
