# ADR 0039 — Obrigatoriedade simples e condicional de colunas

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Contexto

Contratos públicos exigem regras como "Processo SEI é obrigatório quando OS emitida = Sim". A regra precisa valer na Tabela, no Kanban, em formulários, importações e na API pública, sem bloquear edições antigas que já violavam uma regra criada depois.

## Decisão

- `column_definitions.is_required` e `required_when` (a mesma AST de filtro E/OU do ADR 0005, com tokens como `me` e `today`).
- Avaliação única em `packages/shared` (`missingRequiredColumns`):
  - `isRequired`: exigida ao **criar** o item e quando a pessoa **esvazia** o campo.
  - `requiredWhen`: exigida quando a mudança faz a condição **passar a valer** ou quando o próprio campo é esvaziado com a condição valendo.
  - Itens que já violavam a regra não bloqueiam edições não relacionadas.
  - Colunas calculadas e subitens não entram na regra.
- O **servidor impõe** (422 `required_fields_missing` com `fields: [{ key, title }]`); o **cliente antecipa** a mesma avaliação e abre o diálogo "Campos obrigatórios" com os editores de cada tipo antes de enviar. Se o servidor ainda responder 422 (regra mudou), o diálogo abre com os campos informados.
- Em lote (colar, editar em massa), um único diálogo coleta os valores e aplica a todos os itens afetados.

## Consequências

- Mesma regra em todas as superfícies; o Gherkin do "Processo SEI" é coberto por teste de API e E2E.
- Importações relatam linhas que violariam a regra como erros, sem interromper o lote.
