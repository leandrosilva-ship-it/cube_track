# ADR 0042 — Importação e exportação CSV/Excel no servidor

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Decisão

- **Importação em duas etapas:**
  1. `POST /v1/boards/:id/imports` recebe o arquivo (base64, até 10 MB e 5.000 linhas; CSV com delimitador detectado ou XLSX via `exceljs`), devolve cabeçalhos, amostra e **mapeamento sugerido**; a prévia fica 30 min no Redis.
  2. `POST …/imports/:importId/commit` aplica o mapeamento (`name`, `group`, `column:<chave>` ou ignorar), o grupo de destino e `createMissing` (cria grupos, colunas, rótulos e opções inexistentes), no idioma escolhido, e devolve criados, ignorados e erros por linha.
- **Exportação** `GET /v1/boards/:id/export?format=csv|xlsx` com os mesmos filtros, busca e ordenação da Tabela, em streaming (`StreamableFile`); CSV com BOM e `;` em pt-BR/es.
- A conversão texto ↔ valor (`parseCellText`/`formatCellText` em `packages/shared`) é **a mesma** de colar na Tabela e de mover entre boards: o que se exporta, se reimporta. A exibição agrupa milhares (`1.505,00`); a cópia para a área de transferência não agrupa.

### Pós-lançamento: exports reais do Monday e criação automática de colunas

Um export real do Monday (board com várias centenas/milhares de itens) revelou duas lacunas:

- **Leitura do XLSX limitada à largura de cada linha.** `ExcelJS` só itera as células já preenchidas
  de cada linha (`row.eachCell`); numa linha esparsa (ex.: o título do board do Monday, preenchido
  só na 1ª célula) isso produzia uma única coluna bogus em vez do cabeçalho real. Corrigido lendo
  sempre até `sheet.actualColumnCount` (a largura da PLANILHA, não da linha).
- **Formato "tudo numa aba só" do Monday não era reconhecido.** O export do Monday traz, numa única
  aba: o nome do board (linha solo), depois, para cada grupo, uma linha-marcador (só a 1ª célula
  preenchida) seguida dos itens — sem repetir o cabeçalho por grupo — e às vezes termina com um
  bloco de resumo (ex.: total de UST por contrato) que repete o início do cabeçalho e some o resto.
  `mondaySheetToTable` (`packages/shared/src/importers.ts`) normaliza esse formato para a tabela
  genérica `{headers, rows}` (grupo sintético na 1ª coluna, resumo final descartado) — é um
  passthrough para CSV/Excel comuns (inclusive o próprio export da plataforma), então roda sem
  condição de origem, em ambos os caminhos (CSV e XLSX) do importador síncrono.
- **`createMissing` agora também cria colunas.** Um cabeçalho sem coluna correspondente no board e
  com algum valor preenchido vira uma PROPOSTA de coluna nova (`proposedColumns` na prévia, tipo
  inferido dos valores por `inferColumnType` — data, número, status para poucos valores repetidos,
  texto/texto longo como padrão seguro) em vez de "ignorar"; o usuário revisa o tipo antes de
  confirmar (`newColumnTypes` no commit) e `createMissing` decide se ela é mesmo criada, via
  `ColumnsService.create` (mesma validação/posição de criar pela tela de colunas — exige
  `column.manage`, não só `item.create`). A checagem de permissão por coluna (`column.update`) é
  pulada só para colunas criadas NESTE commit: o cache de permissões só é invalidado depois do
  commit da transação (de propósito, para nunca recachear dados ainda não comitados), então ainda
  não enxergaria a coluna nova — e ela já nasceu sob `column.manage`, uma checagem mais forte.
- A tela de importação (`ImportDialog`) ganhou um atalho **"baixar modelo de exemplo"**, que exporta
  o board atual (mesmo endpoint de exportação) como referência de formato — reaproveita a própria
  exportação em vez de manter um arquivo de exemplo separado.

## Consequências

- O limite de corpo da API é 15 MB só na rota de importação (2 MB nas demais).
- Importações grandes (acima de 5.000 linhas) e de outras ferramentas (Monday, Jira, Trello) entram no Prompt 15 como jobs no worker — esse pipeline (Prompt 15) ainda só lê CSV, sem a normalização do Monday acima; migrar para lá fica para quando um export real passar de 5.000 linhas.
