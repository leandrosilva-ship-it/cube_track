# ADR 0053 — Gestão de Portfólio (PPM)

- **Status:** Aceita
- **Data:** 2026-10-29
- **Prompt:** 12

## Contexto

O Prompt 12 entrega a camada estratégica sobre a hierarquia Portfólio → Programa → Projeto (board)
já modelada desde o schema antecipado do Prompt 2: rollup automático de prazo/custo/esforço/UST/
riscos, saúde do projeto (RAG) calculada por regras configuráveis (em vez de só relatada manualmente,
como entregue no Prompt 9), priorização por pontuação ponderada ou WSJF com matriz valor × esforço e
ranking, stage-gates com checklist e decisão, orçamento (planejado × realizado × previsto) com Earned
Value Management (PV/EV/AC/SPI/CPI/EAC/VAC), riscos e problemas, relatório de status por
board/programa/portfólio exportável em PDF, e simulação what-if de cenários de portfólio. As tabelas
(`portfolios`, `programs`, `scoring_models`, `project_health`, `scores`, `stage_gates`, `risks`,
`issues`, `budgets`, `cost_entries`) e as permissões (`portfolio.manage`, `portfolio.read`) já
existiam desde o schema antecipado do Prompt 2, com `boards.portfolioId`/`boards.programId` e seed
completo (portfólio "Contratos Públicos", programa "PMSP – Transformação Digital", scoring model,
score, stage gates, riscos, um problema, um orçamento com lançamentos de custo) — este prompt entrega
o motor de cálculo (shared), a API, o recálculo automático no worker e o frontend sobre elas.

Única tabela nova: `health_rule_sets` (conjunto de regras de RAG automático, por board ou padrão do
tenant). Novas colunas em `project_health` (`isAutomatic`, `overrideReason`, `plannedValue`/
`earnedValue`/`actualCost`/`eac`/`vac`) e em `scoring_models` (`method: 'weighted'|'wsjf'`) —
migrações `0019_portfolio_health_rules.sql` (schema, gerada por `drizzle-kit`) e
`0020_health_rule_sets_rls.sql` (RLS + trigger `updated_at`, migração `--custom`, mesmo padrão de
toda tabela nova do projeto) e `0021_portfolio_health_candidates.sql` (função
`app.portfolio_health_candidates()` para o cron diário, abaixo).

## Decisões

### Motor de portfólio em `packages/shared`, puro e síncrono

- `packages/shared/src/portfolio.ts` concentra cinco sub-motores independentes, todos funções puras
  sem I/O (a API/worker buscam os dados e passam aqui para calcular): regras de saúde
  (`evaluateHealthRules`/`worstHealth`/`defaultHealthRules`), EVM (`plannedValueLinear`/
  `computeEvm`), rollup (`aggregateRollup`), pontuação (`computeWeightedScore`/`computeWsjf`/
  `wsjfInputFromScores`/`classifyEffortValue`/`median`) e what-if (`applyWhatIfChanges`/
  `summarizeWhatIf`). Mesma filosofia do motor de capacidade (ADR 0052) e do motor de automações
  (ADR 0051): lógica testável isoladamente, sem mock de banco.
- `evaluateHealthRules` casa regras **na ordem do array, por dimensão**: a primeira regra cuja
  métrica está disponível e cujo operador bate decide a cor daquela dimensão; métrica ausente faz a
  regra ser ignorada (não é erro); dimensão sem nenhuma regra casando fica `grey`. `overall`, quando
  nenhuma regra própria casa, cai para o pior-caso das outras 5 dimensões — nunca fica `grey` à toa
  se qualquer dimensão tiver dado. `defaultHealthRules()` espelha literalmente o exemplo do critério
  de aceite do prompt (SPI/CPI < 0,9 → amarelo; < 0,8 → vermelho; ≥ 1 risco crítico aberto →
  vermelho).
- **PV é sempre distribuição linear do BAC pelo período do board** (`plannedValueLinear`) — não existe
  baseline time-phased (orçamento fatiado por marco/fase) nesta entrega; é a mesma simplificação que
  Prompt 8 já aceitou para baselines de cronograma (curva S real fica para um prompt futuro de
  orçamento avançado, se necessário). `computeEvm` usa a fórmula padrão de EAC
  (`AC + (BAC-EV)/CPI`, assumindo que o desempenho de custo observado se mantém) e cai para
  `AC + (BAC-EV)` sem CPI disponível (nenhum custo lançado ainda).
- `aggregateRollup` nunca falha com projetos sem orçamento: a média de % concluído pondera por
  `plannedCost`, mas cai para média simples (peso 1 por board) se nenhum tiver orçamento lançado.
  `overall` do rollup é sempre o pior-caso dos projetos agregados — **um portfólio nunca é mais
  saudável que seu pior projeto**, decisão deliberada (não existe "média" de RAG).
- **UST nunca entra no rollup nesta entrega** (`ustTotal` sempre `0`) — depende do módulo de
  Contratos/OS (Prompt 13, ainda não construído); documentado também em "Pendências" no roadmap, não
  escondido atrás de um campo que parece funcionar.
- `computeWeightedScore` normaliza cada critério para `[0,1]` conforme `scaleMin`/`scaleMax`/
  `higherIsBetter` antes de ponderar — pesos não precisam somar 1 (normalizados pela soma efetiva).
  WSJF reaproveita o **mesmo** `criteriaScores` genérico de `scores` com 4 chaves fixas por
  convenção (`WSJF_KEYS`: `business_value`/`time_criticality`/`risk_reduction`/`job_size`) em vez de
  um schema próprio — evita duplicar a tabela `scores` para um segundo método de pontuação.
- `classifyEffortValue` usa a **mediana da amostra** (não um limiar fixo) para decidir alto/baixo
  valor e esforço — os quadrantes são sempre relativos ao conjunto de projetos pontuados no momento,
  não a uma escala absoluta.

### RAG automático substitui "sempre manual" do Prompt 9, sem quebrar o relato manual

- Prompt 9 entregou `project_health` deliberadamente manual ("sempre manual, quem relata decide as
  cores... sem motor de EVM automático", `packages/shared/src/project-health.ts`). Este prompt
  **adiciona** o cálculo automático por cima, sem remover o caminho manual: toda linha de
  `project_health` agora tem `isAutomatic` (worker grava `true`; relato humano grava `false`) e
  colunas de EVM brutas (`plannedValue`/`earnedValue`/`actualCost`/`eac`/`vac`), preenchidas só pelo
  cálculo automático (`null` num relato manual, que continua informando `spi`/`cpi` por opinião de
  quem relata, como sempre).
- **Sobrepor manualmente o resultado automático mais recente exige `overrideReason`** — campo novo e
  opcional em `CreateProjectHealthSchema`, exigido pelo servidor (`ProjectHealthService.report()`,
  `apps/api/src/modules/dashboards/application/project-health.service.ts`) só quando a última linha
  do board tem `isAutomatic: true`; sem override em curso, o relato manual continua exatamente como
  no Prompt 9. Mesmo padrão de campo condicionalmente obrigatório de `column.requiredWhen`
  (`packages/shared/src/columns/registry.ts`), aqui decidido pelo estado do servidor em vez de por
  outro campo do próprio corpo da requisição.
- `project_health.changed` é um evento novo, emitido tanto pelo relato manual quanto pelo recálculo
  automático; `project_health.reported` (Prompt 9/10) continua sendo emitido só pelo relato manual,
  para não quebrar quem já consome apenas esse evento.

### Recálculo automático é orientado a evento + cron diário, nunca síncrono na escrita

- `apps/worker/src/processors/portfolio.ts#recomputeBoardHealth`: carrega as regras efetivas do board
  (próprias → padrão do tenant → `defaultHealthRules()` em código, defensivo — todo tenant
  provisionado desde este prompt já ganha um conjunto padrão, `packages/db/src/provisioning.ts`),
  calcula `percentComplete` (média do campo nativo `progress` dos itens de primeiro nível, não
  arquivados), `overdueItemsPct` (mesma classificação de atraso do widget Battery: sem data
  planejada não conta; com data real, atrasado se veio depois; replanejado não conta como atraso;
  senão, atrasado se a data planejada já passou), `openCriticalRisks` (score
  probabilidade × impacto ≥ 15, convenção também usada pelos widgets `risk_heatmap`/
  `portfolio_rollup`), `budgetVariancePct` (`(custoRealizado − BAC) / BAC × 100` — deliberadamente
  mais simples que a variação de custo do EVM, que compara AC a EV: é uma métrica de regra,
  explicável a um PM, não um substituto dos números de EVM gravados à parte), PV
  (`plannedValueLinear`) e o EVM completo (`computeEvm`), avalia as regras e grava uma **linha nova**
  em `project_health` — cada recálculo é um ponto novo na série histórica, dobrando como o "relatório
  periódico" que o escopo do prompt pede, sem precisar de uma tabela própria de status report.
- Dois gatilhos: (1) evento-orientado — `item.created`/`item.updated`/`item.deleted`/`risk.changed`/
  `budget.changed`/`cost_entry.changed` já roteiam para a fila nova `QUEUES.portfolio`
  (`packages/shared/src/jobs.ts`), consumida por `portfolioProcessor`, que recalcula o board afetado
  a cada mudança real; (2) cron diário `portfolio-health-daily`, que recalcula todo board
  `kind: 'project'` ativo mesmo sem mudança recente — necessário porque `plannedValueLinear` deriva
  do tempo decorrido: SPI pode mudar só porque um dia passou, sem nenhuma escrita de negócio. O cron
  usa `app.portfolio_health_candidates()`, uma função `SECURITY DEFINER` de superfície mínima (só
  devolve `tenant_id`/`board_id`, nenhum dado de negócio) — mesmo padrão de
  `app.sla_tracker_alerts()` (ADR 0051) e `app.date_arrives_candidates()` (ADR 0051), necessário
  porque o papel da aplicação não enxerga tenants/boards de outros tenants sob RLS.
- Notificação `project_health_alert` dispara só quando o `overall` automático **piora** (rank
  `grey < green < yellow < red`, comparado à linha anterior) para `yellow`/`red` — recálculos que não
  mudam o status, ou que melhoram, não geram notificação; evita ruído a cada recálculo diário.

### Nenhuma permissão nova: reaproveita o modelo existente de workspace/board

- `portfolio.manage`/`portfolio.read` (workspace, já existiam desde o Prompt 2) governam
  portfólios/programas (CRUD + rollup), modelos de pontuação, ranking/matriz valor × esforço, what-if
  e o relatório de status de portfólio/programa, e a escrita do conjunto de regras de saúde padrão do
  tenant. `board.manage`/`board.read` (já existiam) governam riscos, problemas, stage-gates,
  orçamento de projeto (e seus lançamentos de custo), o conjunto de regras de saúde por board, o
  relatório de status de um board e o envio de pontuação de um board específico (um gerente de
  projeto pontua o próprio projeto para a priorização do portfólio com a mesma permissão de gerenciar
  esse board, não com `portfolio.manage`). Confirmado com quem implementou que `decide()`/
  `ResourceRef` não precisa de um caso próprio para `type: 'portfolio'`/`type: 'program'` — mesmo
  modelo achatado de permissão de workspace que `dashboard.create` já usava.
- Orçamento de programa/portfólio inteiro (`budgets.boardId` nulo) segue a regra `portfolio.manage`;
  só o orçamento de um projeto específico usa `board.manage` — a tabela `budgets` tem exatamente um
  dono (`board`/`program`/`portfolio`, checado em banco desde o schema antecipado), e a permissão de
  escrita segue o dono.

### Tempo real: a maioria é room `board`; recurso de workspace inteiro cai em `tenant`

- `score.changed`, `stage_gate.changed`, `risk.changed`, `issue.changed`, `project_health.changed` e
  `cost_entry.changed` sempre carregam `boardId` e entregam na room do board. `budget.changed` carrega
  `boardId`/`programId`/`portfolioId` (só um não nulo) — quando o orçamento é de um board, entrega na
  room desse board; quando é de programa/portfólio inteiro (`boardId` nulo), cai no fallback de
  broadcast por tenant do `fanout.service.ts`, mesmo mecanismo de `absence.changed`/
  `timesheet_approval.changed` (ADR 0052) e `automation.changed`/`webhook.changed` de workspace
  inteiro (ADR 0051). `portfolio.changed`, `program.changed` e `health_rule_set.changed` (quando
  `boardId` nulo, isto é, regra padrão do tenant) nunca têm board — são sempre tenant.
- **Bug encontrado e corrigido durante a escrita dos testes E2E/documentação deste prompt**:
  `apps/web/src/realtime/apply.ts` (o dispatcher central que aplica patches no cache do TanStack
  Query a partir de eventos) não tinha nenhum caso para os 10 eventos novos — as telas de
  portfólio/governança recebiam os dados certos ao abrir/trocar de aba, mas não atualizavam ao vivo
  quando outra sessão mudava algo, quebrando o padrão "tempo real por padrão" (`CLAUDE.md` §2) e o
  próprio critério de aceite deste prompt. Corrigido: um `case` por evento, mesmo padrão de
  invalidação já usado pelos demais (`qk.*` exato quando o payload traz a ID certa; invalidação por
  predicado, como em `dashboard.changed`/`allocation.changed`, quando não traz — é o caso de
  `project_health.changed`, que não carrega `portfolioId`/`programId`).

## Consequências

- Uma tabela nova (`health_rule_sets`); todas as demais já existiam desde o schema antecipado do
  Prompt 2.
- `ustTotal` do rollup é sempre `0` nesta entrega — fica para o módulo de Contratos/OS/UST
  (Prompt 13).
- `budgetVariancePct` (métrica de regra) e a variação de custo do EVM (`vac`) são deliberadamente
  fórmulas diferentes — a primeira compara custo realizado ao BAC total (simples, para regras); a
  segunda é o VAC padrão de EVM (`BAC − EAC`). Documentar isso evita a leitura errada de que são a
  mesma coisa com nomes diferentes.
- Notificação de risco/problema atribuído dispara só na criação (`change: 'created'`) — reatribuir o
  responsável de um risco/problema já existente (`change: 'updated'`) não notifica o novo
  responsável nesta entrega, por falta de comparação antes/depois nessa camada do worker.
- `plannedValueLinear` é uma aproximação (distribuição linear do orçamento pelo período do board) —
  não reflete uma curva S real ou um orçamento fatiado por fase/marco; aceitável para o critério de
  aceite do prompt (SPI/CPI cruzando um limiar), mas pode divergir de um EVM "de livro-texto" com
  baseline detalhado.
