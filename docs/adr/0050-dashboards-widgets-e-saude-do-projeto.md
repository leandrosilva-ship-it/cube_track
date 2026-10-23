# ADR 0050 — Dashboards, widgets e saúde do projeto

- **Status:** Aceita
- **Data:** 2026-10-23
- **Prompt:** 9

## Contexto

O Prompt 9 soma ao produto um nível de visão agregada: dashboards com widgets alimentados por um
ou mais boards (números, gráficos, bateria de prazos, carga por pessoa) e um relato de saúde do
projeto. As tabelas `dashboards`/`widgets` e o enum `dashboard_visibility` já existiam desde o
Prompt 2 (antecipados no seed, que grava o dashboard "Project Health – PMSP" com seis widgets e uma
view de board `type: 'dashboard'` apontando para ele); o RBAC para o recurso `'dashboard'`
(`dashboard.read`/`dashboard.update` em `packages/shared/src/permissions.ts`, resolução em
`AccessService`) também já estava implementado. Este prompt entrega o módulo de API que lê/escreve
essas tabelas, o motor de agregação dos widgets e o frontend.

## Decisões

### Registro de tipos de widget, no mesmo molde do registro de colunas

- `packages/shared/src/widgets.ts` define `WIDGET_TYPES` (`number`, `chart_bar`, `chart_pie`,
  `battery`, `workload`, `project_health`) e o schema Zod de `config` de cada um, batendo
  exatamente com os widgets já semeados em `packages/db/src/seed/workspace.ts`. O `aggregate`
  (`sum`/`avg`/`min`/`max`/`count`/...) reaproveita o mesmo catálogo `ROLLUP_AGGREGATES` das
  colunas de rollup — não existe um segundo catálogo de agregações.
- `WidgetFilterSchema` é um filtro simples por widget: `{ groupIds }` ou `{ columnKey, operator,
  value }` (um único termo, não a árvore `FilterGroup` completa da Tabela) — widgets agregam sobre
  um board inteiro ou um recorte simples dele, não sobre um filtro avançado construído na UI nesta
  entrega.

### Agregação no servidor reaproveitando `ItemsService`/`ItemQueryBuilder`

- `GET /v1/dashboards/:id/data` (`widget-data.service.ts`) é o único endpoint que o frontend lê
  para desenhar os widgets: cada `config.boardIds` é consultado com `ItemsService.list` (páginas de
  1000, mesmo padrão do export CSV/Excel da Tabela), convertendo o filtro do widget para o mesmo
  `FilterGroup` que `ItemQueryBuilder` já sabe compilar. Isso significa que colunas ocultas,
  permissões por coluna e o escopo de itens de convidado já se aplicam à agregação sem código
  novo; um board que o usuário não pode ler é simplesmente ignorado (zero itens), não um erro que
  derruba o dashboard inteiro.
- A leitura de valor de uma coluna (`cellValue`) é ciente de `binding`, igual ao export: uma
  coluna `date` vinculada a `plannedEndDate` é lida do campo nativo do item, não de `values`. Sem
  essa regra, o widget "bateria de prazos" do próprio seed (colunas `c_termino_planejado` etc.,
  todas vinculadas) sempre devolveria zero — bug encontrado e corrigido ainda durante a escrita
  deste prompt, antes de qualquer teste manual.
- O frontend nunca recalcula: só renderiza `{ categories }` / `{ value }` / `{ onTime, replanned,
  late, noDate }` / `{ people }` / `{ latest, history }` exatamente como a API devolve — mesmo
  princípio de "um endpoint, sem recálculo no cliente" do Gantt (ADR 0049).

### Saúde do projeto: série manual, sem motor de EVM

- `project_health` (schema do Prompt 2, portfólio) ganha CRUD de criação (append-only, sem
  edição/exclusão) e leitura de histórico. Quem relata escolhe as seis cores
  (geral/prazo/custo/escopo/qualidade/risco) e, opcionalmente, `percentComplete`/`spi`/`cpi`/
  resumo — nada é calculado automaticamente a partir do cronograma. Um motor de valor agregado
  (EVM) fica fora de escopo: a saúde do projeto nesta entrega é um relato humano, como em
  PPM tradicional (Planview etc.), não um indicador derivado.
- Relatar exige `board.manage` (o mesmo nível de quem administra o board), não uma permissão nova
  — criar uma permissão dedicada só para isto seria uma dimensão a mais no RBAC sem um caso de uso
  que a justifique agora.

### Dashboard: dono sempre edita; workspace.manage edita os de visibilidade `workspace`

- Nenhuma regra nova: o caso `'dashboard'` de `decide()` já existia (Prompt 3) e não mudou. Este
  prompt só adiciona `canEdit: boolean` ao DTO (computado com a mesma `decide()`), para o frontend
  decidir sem reimplementar a regra — o mesmo padrão que `BoardDetail.permissions` já usa.
- Editar um widget exige `dashboard.update` do dashboard a que ele pertence — não existe uma
  permissão de widget separada; gerenciar os widgets de um dashboard é gerenciar o dashboard.

### Frontend: view `dashboard` embutida reaproveita a mesma tela do dashboard standalone

- A view de board `type: 'dashboard'` grava só `{ dashboardId }` no `config` — o mesmo padrão já
  usado pela view `form` (`{ formId }`, ADR 0049): a visualização embutida nas abas do board e a
  página standalone em `/w/:workspaceId/dashboards/:id` renderizam o mesmo componente
  `DashboardView`, sem duplicar a grade de widgets.
- **Reposicionamento simples, sem grade arrastável**: cada widget tem um `layout {x,y,w,h}` fixo;
  um novo widget é empilhado abaixo do último (`nextWidgetLayout`), e "mover para cima/baixo" troca
  o `layout` com o vizinho. Não há arrastar-e-redimensionar livre nesta entrega — mesma lacuna de
  escopo que o Gantt já assumiu para as barras (ADR 0049): construir um sistema de grade livre
  (tipo `react-grid-layout`) é uma entrega à parte, não necessária para o valor central do prompt
  (ver widgets, números e gráficos corretos).
- **Gráficos**: `packages/ui` ganha `Chart`, um wrapper fino do ECharts via `echarts/core`
  (tree-shaken: só `BarChart`/`PieChart`/`SVGRenderer`/componentes de grid/legenda/tooltip) — SVG em
  vez de canvas, mais leve e sem depender do pacote `canvas` do Node para os testes em jsdom. A cor
  de cada categoria vem do `color` (hex) já gravado em `status_labels`/`dropdown_options`; sem cor,
  cai numa paleta categórica fixa.
- **Tempo real**: dashboards e widgets não tinham room própria assinada pelo cliente antes deste
  prompt. `RealtimeClient.watchDashboard` (mesmo molde de `watchItem`: sem replay/seq, só entrega de
  evento) assina a room `dashboard` enquanto a tela está aberta; `dashboard.changed`/`widget.changed`
  (novos tipos de evento, ADR 0027) invalidam a lista de dashboards e os dados/widgets do dashboard
  aberto. `project_health.reported` viaja pela room do **board** (mesmo padrão de todo evento
  ligado a um board) — um dashboard standalone que não seja o board atualmente aberto só atualiza
  pelo próximo `refetch` (poll via `refreshIntervalSeconds`, se configurado) ou ao reabrir a tela;
  cobrir esse caso cruzado (saber quais dashboards referenciam um board para também entregar na
  room `dashboard`) fica para quando houver um caso de uso real para isso.
- **Construtor de widget simplificado**: o formulário usa as colunas do **primeiro** board de
  `sourceBoardIds` para os seletores de coluna (categoria/valor/datas/pessoas), mesmo quando o
  widget agrega vários boards — assume-se que os boards de um mesmo dashboard compartilham a
  convenção de chaves de coluna (o caso comum, um board "principal" com variantes). Um seletor de
  coluna por board, ou um alias de coluna entre boards diferentes, fica para quando houver um
  dashboard real combinando boards com esquemas distintos.

## Consequências

- Nenhuma tabela nova: `dashboards`, `widgets` e `project_health` já existiam desde o Prompt 2 —
  este prompt é só API + frontend sobre um schema já estável, reduzindo o risco de migração.
- A pendência de "agregação no servidor para boards muito grandes" registrada no Prompt 5 fica
  resolvida para o caso de **dashboards** (que já agregam no servidor via `ItemsService`); os
  rodapés da própria Tabela continuam agregando no cliente sobre os itens carregados — migrá-los
  para o mesmo mecanismo é um retrofit de uma tela já estável, não o foco deste prompt.
- O dashboard "Project Health – PMSP" do seed passa a ser renderizável de ponta a ponta (API real,
  não mais só dados de demonstração no banco).
- Lacunas conhecidas, documentadas para um prompt futuro: grade de widgets sem arrastar-e-soltar
  livre nem redimensionar; construtor de widget usa as colunas de um único board mesmo com vários
  `sourceBoardIds`; `project_health.reported` não alcança dashboards standalone que não sejam o
  board atualmente aberto em outra aba/navegador.
