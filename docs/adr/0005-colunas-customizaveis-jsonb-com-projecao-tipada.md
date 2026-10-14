# ADR 0005 — Colunas customizáveis: JSONB como fonte da verdade + projeção tipada para filtro/ordenação

- **Status:** Aceita (benchmark de validação no Prompt 2)
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
Usuários criam colunas de ~30 tipos sem código. Views precisam filtrar (E/OU), ordenar multi-coluna, agrupar e agregar sobre boards de até 50 mil itens, com paginação por cursor. Criar coluna não pode exigir DDL.

## Decisão
1. `items.values jsonb` guarda `{ columnId: valorTipado }`, com formato por tipo definido no **registro de tipos de coluna** (`packages/shared/src/columns`, schemas Zod usados em front e back).
2. `items.field_versions jsonb` guarda a versão por campo (LWW, ADR 0008).
3. Índice **GIN `jsonb_path_ops`** em `values` para filtros de igualdade/contém (status, dropdown, pessoas, tags).
4. Tabela **`item_field_index`** (projeção tipada: `v_num`, `v_date`, `v_ts`, `v_text`, `v_bool`) com índices compostos `(tenant_id, board_id, column_id, v_*, item_id)`, mantida **na mesma transação** pelo repositório, apenas para tipos escalares ordenáveis/filtráveis por faixa.
5. Colunas de sistema (nome, grupo, posição, datas de criação/atualização, arquivamento) são colunas físicas de `items`.
6. Colunas computadas (fórmula, espelho/lookup, rollup) avaliadas pelo worker com grafo de dependências e materializadas em `values`.
7. Módulos com regra de negócio forte (Contratos/UST, cronograma) usam **tabelas relacionais próprias** e expõem campos como *bound columns*.
8. Filtros de view são uma **AST tipada** (Zod) traduzida para SQL por um query builder único, reutilizado por views, automações, dashboards e API pública.

## Alternativas consideradas
- **Só JSONB**: ordenação/faixa exigiria índices de expressão por coluna (DDL dinâmica, explosão de índices).
- **EAV puro**: leitura de página = N×M linhas + pivot; agregações boas, mas leitura ruim.
- **Tabelas dinâmicas por board**: DDL em produção, locks, RLS por tabela, migrações e backups complexos.

## Consequências
- Escrita com pequena amplificação (UPDATE em `items` + UPSERT em `item_field_index`).
- Mudança de tipo de coluna exige job de conversão (worker) com reprocessamento da projeção.
- Meta a validar: página de 100 itens filtrada e ordenada em board de 50k < 80 ms p95 (banco).
