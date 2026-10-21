# ADR 0044 — Views salvas: registro, pessoal/compartilhada, padrão e duplicação

- **Status:** Aceita
- **Data:** 2026-10-16
- **Prompt:** 6

## Contexto

Cada board precisa de várias visões do mesmo dado (Tabela, Kanban, Calendário, Gantt, Formulário, Mapa, Gráfico, Arquivos, Carga de trabalho, Dashboard) com filtros, ordenação, agrupamento e colunas visíveis próprios, salvos e reabertos como abas. Views podem ser pessoais (só o dono vê) ou compartilhadas (todo mundo com acesso ao board), com uma padrão por dono (pessoal) ou por board (compartilhada).

A tabela `views` e o tipo `share_resource` já existiam desde o schema inicial (Prompt 2); faltava o contrato de `config`/`filters`/`sort`/`groupBy` e a API.

## Decisão

- **Contrato único em `packages/shared/src/views.ts`**, consumido igual pela API e pelo web:
  - `ViewType` = `table | kanban | calendar | timeline | gantt | form | map | chart | files | workload | dashboard`; `IMPLEMENTED_VIEW_TYPES` marca quais têm tela própria agora (`table`, `kanban`) — as demais mostram "em breve" (mesmo padrão de Integrar/Automatizar/Agentes).
  - `filters` reusa a AST de filtro do ADR 0005 (`FilterGroupSchema`), não um formato próprio.
  - `sort`: lista de até 3 `{ columnKey, direction }` (nome de campo igual ao do schema do banco; um conversor (`viewSortToQueryString`) traduz para o parâmetro `field:dir` que a Tabela já usa).
  - `groupBy`: até 3 níveis (`'group'` ou chave de coluna).
  - `config`: validado por tipo (`parseViewConfig`) — por ora `KanbanConfigSchema` e `TableConfigSchema`; os demais tipos aceitam um objeto genérico até ganharem tela própria.
  - `hiddenColumnKeys`: lista de colunas ocultas específica da view (além da redação por permissão de coluna).
- **Governança**: `isDefault`, `isLocked` e `isRestricted` só mudam com a permissão `view.manage` do board (armazenada), mesmo em views compartilhadas que o usuário pode editar porque é o dono. No máximo uma view padrão por dono (pessoal) ou por board (compartilhada) — ao marcar uma, as demais do mesmo escopo perdem o padrão na mesma transação.
- **Duplicar** (`POST views/:id/duplicate`) copia tipo, config, filtros, ordenação, agrupamento e colunas ocultas; a cópia é sempre independente (nunca referencia a original) e nasce como não padrão, não bloqueada e não restrita.
- Sem migração nova: a tabela e as colunas já existiam; só o contrato de validação e os endpoints foram adicionados.

## Consequências

- Front-end e API validam exatamente o mesmo formato de filtro/ordenação/agrupamento — zero tradução ad-hoc entre Tabela e Kanban.
- Adicionar uma nova view implementada no futuro (Calendário, Gantt) exige só um novo schema de `config` em `views.ts` e uma tela; a API e o banco não mudam.
- Views compartilhadas "trancadas" (`isLocked`) continuam editáveis por quem gerencia o board, preservando o caso de uma view de referência que o time não deve poder quebrar sem querer.
