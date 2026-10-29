# Gestão de Portfólio (PPM)

Referência da hierarquia Portfólio → Programa → Projeto, RAG automático, orçamento/EVM, priorização,
stage-gates, riscos/problemas e relatório de status (Prompt 12). Decisões de arquitetura em
`docs/adr/0053-gestao-de-portfolio.md`.

## 1. Modelo de dados

Tabelas em `packages/db/src/schema/portfolio.ts`, todas `tenant_id` + RLS. Todas já existiam desde o
schema antecipado do Prompt 2, exceto `health_rule_sets` (nova) e as colunas novas marcadas abaixo:

| Tabela           | Campos principais                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `scoring_models`  | `name`, `description`, **`method: 'weighted'\|'wsjf'` (novo)**, `criteria: ScoringCriterion[]`, `isDefault` |
| `portfolios`      | `workspaceId`, `folderId`, `name`, `ownerId`, `scoringModelId`, `status`, `position`                 |
| `programs`        | `workspaceId`, `portfolioId`, `name`, `ownerId`, `status`, `startDate`/`endDate`, `position`          |
| `project_health`  | `boardId`, `reportedBy`, `reportedAt`, `overall`/`schedule`/`cost`/`scope`/`quality`/`risk` (RAG), `percentComplete`, `spi`/`cpi`, `summary`, **`isAutomatic` (novo)**, **`overrideReason` (novo)**, **`plannedValue`/`earnedValue`/`actualCost`/`eac`/`vac` (novos, EVM bruto)** |
| `health_rule_sets` | **(tabela nova)** `boardId` (nulo = padrão do tenant), `rules: HealthRule[]` (array, máx. 50)       |
| `scores`          | `scoringModelId`, `boardId` (único por par), `criteriaScores: Record<string,number>`, `totalScore`, `scoredBy`/`scoredAt`, `rationale` |
| `stage_gates`     | `boardId`, `name`, `position`, `status: gate_status`, `dueDate`, `criteria: {label,met}[]`, `decidedBy`/`decidedAt`, `notes` |
| `risks`           | `boardId`, `itemId` (opcional), `title`, `description`, `category`, `probability`/`impact` (1–5), `status`, `strategy`, `mitigationPlan`/`contingencyPlan`, `ownerId`, `dueDate`, `closedAt` |
| `issues`          | `boardId`, `itemId`/`riskId` (opcionais), `title`, `description`, `severity`, `status`, `ownerId`, `dueDate`, `resolvedAt`, `resolution` |
| `budgets`         | exatamente um dono não nulo entre `boardId`/`programId`/`portfolioId` (check de banco), `name`, `category: capex\|opex`, `currency`, `plannedAmount`, `fiscalYear`, `periodStart`/`periodEnd` |
| `cost_entries`    | `budgetId`, `boardId`/`itemId` (opcionais), `entryDate`, `amount`, `currency`, `kind: planned\|actual\|forecast`, `source`, `category`, `description`, `reference` |

Migrações deste prompt: `0019_portfolio_health_rules.sql` (schema gerado — `health_rule_sets` +
colunas novas acima), `0020_health_rule_sets_rls.sql` (RLS + trigger `updated_at`, migração
`--custom`) e `0021_portfolio_health_candidates.sql` (função `app.portfolio_health_candidates()` para
o cron diário de recálculo de saúde). `boards.portfolioId`/`boards.programId` (FKs opcionais) já
existiam desde o Prompt 2.

## 2. Motor de portfólio (`packages/shared/src/portfolio.ts`)

Cinco sub-motores, puros e síncronos (sem I/O):

- **Regras de saúde (RAG automático)**: `evaluateHealthRules(rules, metrics)` — por dimensão
  (`overall`/`schedule`/`cost`/`scope`/`quality`/`risk`), a primeira regra cuja métrica
  (`spi`/`cpi`/`overdue_items_pct`/`open_critical_risks`/`budget_variance_pct`) está disponível e
  cujo operador (`lt`/`lte`/`gt`/`gte`/`eq`) bate decide a cor; sem regra casando, `grey`. `overall`
  sem regra própria cai para `worstHealth` das outras 5 dimensões. `defaultHealthRules()` sugere um
  conjunto inicial (SPI/CPI < 0,8 → vermelho, < 0,9 → amarelo; ≥ 1 risco crítico aberto → vermelho).
- **EVM**: `plannedValueLinear` distribui o BAC linearmente pelo período do board (sem baseline
  time-phased); `computeEvm` calcula `PV/EV/AC/SPI/CPI/EAC/VAC` (EAC pela fórmula padrão
  `AC + (BAC-EV)/CPI`, caindo para `AC + (BAC-EV)` sem CPI disponível).
- **Rollup**: `aggregateRollup(boards[])` soma custos/UST (sempre `0` — ver §6)/riscos e calcula a
  média de % concluído ponderada por orçamento planejado; `overall` é sempre o pior-caso dos projetos
  agregados.
- **Pontuação**: `computeWeightedScore` normaliza cada critério em `[0,1]` por escala/sentido e pondera;
  `computeWsjf`/`wsjfInputFromScores`/`WSJF_KEYS` (`business_value`/`time_criticality`/
  `risk_reduction`/`job_size`, chaves fixas dentro do mesmo `criteriaScores` genérico quando
  `scoringModels.method === 'wsjf'`); `classifyEffortValue`/`median` classificam um projeto na matriz
  valor × esforço pela mediana da amostra (relativo, não um limiar fixo).
- **What-if**: `applyWhatIfChanges` aplica `include`/`exclude`/`delay` a uma lista-base de projetos;
  `summarizeWhatIf` resume o cenário resultante (projetos ativos, custo total, data de término mais
  distante).

## 3. API

Um módulo novo, `apps/api/src/modules/portfolio/`, com 4 controllers:

### Portfólios, programas, pontuação, what-if (`portfolio.controller.ts`)

| Rota                                                            | Permissão                                     |
| ------------------------------------------------------------------ | -------------------------------------------------- |
| `GET/POST workspaces/:workspaceId/portfolios`                       | `workspace.read` / `portfolio.manage`              |
| `GET/PATCH/DELETE portfolios/:id`, `GET portfolios/:id/rollup`      | `portfolio.read` (leitura) / `portfolio.manage` (escrita) |
| `GET/POST workspaces/:workspaceId/programs`                         | `workspace.read` / `portfolio.manage`              |
| `GET/PATCH/DELETE programs/:id`, `GET programs/:id/rollup`          | `portfolio.read` (leitura) / `portfolio.manage` (escrita) |
| `GET/POST scoring-models`, `PATCH scoring-models/:id`               | `portfolio.read` (leitura) / `portfolio.manage` (escrita) |
| `POST boards/:boardId/score`                                        | `board.manage` do board pontuado                   |
| `GET scoring-models/:id/ranking`, `GET .../value-effort`            | `portfolio.read`                                   |
| `POST portfolio/what-if`                                            | `portfolio.manage`                                 |

### Stage-gates, riscos, problemas (`governance.controller.ts`)

| Rota                                                              | Permissão                      |
| ---------------------------------------------------------------------- | ----------------------------------- |
| `GET/POST boards/:boardId/stage-gates`                                  | `board.read` / `board.manage`       |
| `PATCH stage-gates/:id`, `POST stage-gates/:id/decide`, `DELETE`         | `board.manage`                      |
| `POST boards/:boardId/stage-gates/reorder`                              | `board.manage`                      |
| `GET/POST boards/:boardId/risks`, `PATCH/DELETE risks/:id`               | `board.read` / `board.manage`       |
| `GET/POST boards/:boardId/issues`, `PATCH/DELETE issues/:id`             | `board.read` / `board.manage`       |

### Orçamento e custos (`budget.controller.ts`)

| Rota                                                                | Permissão                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `GET/POST boards/:boardId/budgets`                                       | `board.read` / `board.manage`                               |
| `POST programs/:programId/budgets`, `POST portfolios/:portfolioId/budgets` | `portfolio.manage`                                          |
| `PATCH/DELETE budgets/:id`                                                | `board.manage` (orçamento de board) ou `portfolio.manage` (orçamento de programa/portfólio) |
| `GET/POST budgets/:id/cost-entries`, `PATCH/DELETE cost-entries/:id`       | mesma regra do orçamento dono                               |

### Regras de saúde e relatório de status (`health.controller.ts`)

| Rota                                              | Permissão                            |
| ------------------------------------------------------ | ------------------------------------------ |
| `GET health-rules/default`                              | `workspace.read`                           |
| `PUT health-rules/default`                              | `portfolio.manage`                         |
| `GET boards/:boardId/health-rules`                      | `board.read`                               |
| `PUT boards/:boardId/health-rules`                      | `board.manage`                             |
| `GET boards/:boardId/status-report`                     | `board.read`                               |
| `GET portfolios/:id/status-report`, `programs/:id/...`  | `portfolio.read`                           |

**Nenhuma permissão nova**: tudo reaproveita `portfolio.manage`/`portfolio.read` (workspace, desde o
Prompt 2) e `board.manage`/`board.read` (board). `decide()`/`ResourceRef` não tem um caso próprio
para portfólio/programa — mesmo modelo achatado de permissão de workspace de `dashboard.create`.

**Override de relato automático**: `ProjectHealthService.report()` (Prompt 9, estendido aqui) rejeita
com 400 (`path: 'body.overrideReason'`) um relato manual quando a última linha do board é automática
e `overrideReason` vem vazio — exigido só nesse caso, nunca para o primeiro relato de um board ou
para sobrepor outro relato manual.

## 4. Worker — RAG automático e EVM

`apps/worker/src/processors/portfolio.ts#recomputeBoardHealth` roda em dois gatilhos:

1. **Orientado a evento**: `item.created`/`item.updated`/`item.deleted`/`risk.changed`/
   `budget.changed`/`cost_entry.changed` roteiam para a fila `QUEUES.portfolio`
   (`packages/shared/src/jobs.ts`), que recalcula o board afetado a cada mudança real.
2. **Cron diário** (`portfolio-health-daily`): recalcula todo board `kind: 'project'` ativo mesmo sem
   mudança de negócio — necessário porque o PV (`plannedValueLinear`) deriva do tempo decorrido.
   Candidatos vêm de `app.portfolio_health_candidates()`, função `SECURITY DEFINER` de superfície
   mínima (só `tenant_id`/`board_id`), mesmo padrão de `app.sla_tracker_alerts()`.

Cálculo, por recálculo:

- **`percentComplete`**: média do campo nativo `progress` dos itens de primeiro nível (não
  arquivados, não subitens) do board.
- **`overdueItemsPct`**: mesma classificação de atraso do widget de dashboard Battery — sem data
  planejada não conta; com data real, atrasado se veio depois da planejada; replanejado não conta
  como atraso; senão, atrasado se a planejada já passou.
- **`openCriticalRisks`**: riscos `open`/`mitigating` com `probabilidade × impacto ≥ 15` (convenção
  também usada pelos widgets `risk_heatmap`/`portfolio_rollup`).
- **`budgetVariancePct`**: `(custo realizado − BAC) / BAC × 100` — métrica simples de regra,
  deliberadamente diferente do VAC do EVM (que compara AC a EV), guardado à parte.
- **EVM completo** (`PV`/`EV`/`AC`/`SPI`/`CPI`/`EAC`/`VAC`) via `plannedValueLinear` + `computeEvm`.

O resultado vira uma **linha nova** em `project_health` (`isAutomatic: true`) — cada recálculo é um
ponto novo na série histórica, servindo também de registro periódico de status sem precisar de uma
tabela própria. Evento `project_health.changed` emitido sempre; notificação `project_health_alert`
só quando o `overall` **piora** (rank `grey < green < yellow < red`) para `yellow`/`red` em relação ao
relato anterior — evita ruído a cada recálculo que não muda nada.

**Notificações novas** (`apps/worker/src/processors/notifications.ts`): `risk_assigned`/
`issue_assigned` (ao definir `ownerId` **na criação** — reatribuir via edição não notifica nesta
entrega, lacuna documentada) e `project_health_alert` (ao board `ownerId`, quando o RAG automático
piora).

## 5. Frontend

| Tela                                                     | Onde                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Hierarquia Portfólio → Programa → Projeto, com rollup         | `apps/web/src/features/portfolio/hierarchy-panel.tsx` + `rollup-card.tsx`                      |
| Priorização (scoring/WSJF, ranking, matriz valor × esforço)   | `prioritization-panel.tsx` + `scoring-model-dialog.tsx` + `score-board-dialog.tsx`              |
| Simulação what-if                                             | `what-if-panel.tsx`                                                                             |
| Relatório de status de portfólio/programa                     | `status-report-panel.tsx`                                                                       |
| Página standalone                                              | `/w/:workspaceId/portfolio` (`portfolio-page.tsx`, 4 abas acima), link no cabeçalho do workspace |
| Governança do projeto (board `kind: 'project'`)                | diálogo "Governança" em `board-header.tsx` → `governance-dialog.tsx` (6 abas)                   |
| Stage-gates, riscos, problemas, orçamento/EVM, regras de saúde, relatório | `apps/web/src/features/governance/{stage-gates,risks,issues,budget,health-rules}-panel.tsx` + `status-report-view.tsx` |
| Project Health (Prompt 9, estendido)                           | `apps/web/src/features/dashboards/{project-health-dialog,project-health-widget}.tsx` — selo Automático/Manual, números de EVM, campo de justificativa condicionalmente obrigatório |
| Widgets de dashboard novos                                     | `portfolio_rollup`, `risk_heatmap`, `budget_variance` em `widget-card.tsx`/`widget-dialog.tsx`  |

Exportação em PDF do relatório de status reaproveita o mesmo padrão html2canvas+jspdf já usado pelo
Gantt e pelo Dashboard (Prompt 8/9) — nenhuma biblioteca nova.

## 6. Tempo real

`packages/shared/src/events.ts`, documentados também em `docs/realtime-events.md` §4: `portfolio.changed`/
`program.changed` (tenant), `score.changed`/`stage_gate.changed`/`risk.changed`/`issue.changed`/
`project_health.changed`/`cost_entry.changed` (board), `budget.changed` (board ou tenant, conforme o
dono do orçamento), `health_rule_set.changed` (board ou tenant, conforme `boardId`).

Todos os 10 têm `case` em `apps/web/src/realtime/apply.ts` (o dispatcher central de patches no cache
do TanStack Query): cada um invalida a lista/rollup/relatório correspondente. `project_health.changed`
(disparado pelo recálculo automático de RAG/EVM) não carrega `portfolioId`/`programId` — invalida por
predicado toda chave que contenha `'rollup'` ou `'status-report'`, mesmo padrão já usado por
`dashboard.changed`/`allocation.changed` para casos em que o payload não traz a chave exata. Achado e
corrigido durante a escrita dos testes E2E/documentação deste prompt (a wiring simplesmente não
existia até este ponto da entrega).

## 7. Escopo cortado nesta entrega (documentado, não escondido)

- **UST no rollup**: sempre `0` — depende do módulo de Contratos/OS (Prompt 13).
- **Notificação de reatribuição**: `risk_assigned`/`issue_assigned` disparam só na criação; editar o
  responsável de um risco/problema já existente não notifica o novo responsável.
- **PV é sempre linear**: `plannedValueLinear` distribui o BAC uniformemente pelo período do board —
  não há baseline time-phased (orçamento fatiado por fase/marco).
- **Nivelamento/matriz valor×esforço são heurísticos**: `classifyEffortValue` usa a mediana da
  amostra corrente (relativo, não um corte fixo de "alto"/"baixo").
- **Testes de integração (API/worker) e E2E Playwright**: escritos nesta entrega mas **não
  executados neste ambiente** (sandbox sem Postgres/Redis/Docker) — mesma limitação documentada
  desde o Prompt 3.

## 8. Como rodar e testar

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay + recálculo de saúde/RAG + notificações
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm --filter @cube-track/shared test    # motor de portfólio (portfolio.test.ts)
pnpm --filter @cube-track/web test       # modelos de portfolio/governance
pnpm --filter @cube-track/api test       # portfolio.e2e.test.ts
pnpm --filter @cube-track/worker test    # recálculo de saúde/RAG, notificações (processors.e2e.test.ts)
pnpm --filter @cube-track/web test:e2e   # fluxos de portfólio/governança em tempo real
```
