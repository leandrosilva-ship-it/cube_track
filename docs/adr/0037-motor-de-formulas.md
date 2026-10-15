# ADR 0037 — Motor de fórmulas próprio, decimal e compartilhado

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Contexto

A coluna Fórmula precisa de sintaxe familiar (Excel/Monday), aritmética exata para dinheiro e UST, funções de data com dias úteis e feriados brasileiros, e o mesmo resultado no servidor (fonte da verdade), no worker e no cliente (validação ao digitar).

Bibliotecas prontas (hot-formula-parser, formula.js, mathjs) usam `float`, não conhecem referências de coluna nem o calendário de trabalho do board, e exigiriam `eval`/adaptações.

## Decisão

- Parser e avaliador próprios em `packages/shared/src/formula` (tokenizer → AST → avaliador), sem `eval`.
- **Números são decimais** (`decimal.js-light`, 40 dígitos, arredondamento "metade para longe do zero"); o armazenamento usa até 4 casas. Nunca `float`.
- **Referências** são `{chave}` no armazenamento; a interface aceita `{Título da coluna}` e normaliza para a chave ao salvar (`normalizeFormulaReferences`), exibindo de volta com `displayFormula`. Renomear coluna não quebra fórmulas.
- Separador de argumentos `;` ou `,`; operadores `+ - * / ^ & = <> < <= > >=` e `%`.
- 60 funções lógicas, matemáticas, de data (incluindo `WORKDAYS` e `ADD_WORKDAYS` com o calendário do board), de texto e de informação (catálogo em `FORMULA_FUNCTIONS`, documentado em `docs/columns.md`).
- Erros tipados no estilo de planilha (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#NUM!`, `#N/A`) gravados no valor (`{ error }`) e exibidos na célula; ciclos entre fórmulas viram `#REF!`.
- Fórmulas com `TODAY()`/`NOW()` são **voláteis** e recalculadas diariamente (ADR 0038).

## Consequências

- Mesmo resultado em API, worker e web; testes unitários cobrem funções, precisão e erros.
- Novas funções entram no catálogo com aridade declarada (validação sintática no cliente e no servidor).
- Fórmulas não acessam outros itens; agregações entre itens usam Rollup/Espelho (ADR 0038).
