# ADR 0042 — Importação e exportação CSV/Excel no servidor

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Decisão

- **Importação em duas etapas:**
  1. `POST /v1/boards/:id/imports` recebe o arquivo (base64, até 10 MB e 5.000 linhas; CSV com delimitador detectado ou XLSX via `exceljs`), devolve cabeçalhos, amostra e **mapeamento sugerido**; a prévia fica 30 min no Redis.
  2. `POST …/imports/:importId/commit` aplica o mapeamento (`name`, `group`, `column:<chave>` ou ignorar), o grupo de destino e `createMissing` (cria rótulos e opções inexistentes), no idioma escolhido, e devolve criados, ignorados e erros por linha.
- **Exportação** `GET /v1/boards/:id/export?format=csv|xlsx` com os mesmos filtros, busca e ordenação da Tabela, em streaming (`StreamableFile`); CSV com BOM e `;` em pt-BR/es.
- A conversão texto ↔ valor (`parseCellText`/`formatCellText` em `packages/shared`) é **a mesma** de colar na Tabela e de mover entre boards: o que se exporta, se reimporta. A exibição agrupa milhares (`1.505,00`); a cópia para a área de transferência não agrupa.

## Consequências

- O limite de corpo da API é 15 MB só na rota de importação (2 MB nas demais).
- Importações grandes (acima de 5.000 linhas) e de outras ferramentas (Monday, Jira, Trello) entram no Prompt 15 como jobs no worker.
