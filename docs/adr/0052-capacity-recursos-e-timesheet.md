# ADR 0052 — Capacity, Recursos e Timesheet

- **Status:** Aceita
- **Data:** 2026-10-28
- **Prompt:** 11

## Contexto

O Prompt 11 fecha o ciclo de gestão de pessoas sobre o trabalho já modelado nos prompts
anteriores: perfil de recurso (cargo, custo/hora, jornada, calendário pessoal), alocação planejada
por board/item, ausências, apontamento de horas (timesheet) com aprovação do gestor, solicitação de
recurso por um gestor de projeto e um motor de capacidade (heatmap disponível × alocado,
nivelamento, simulação what-if, previsão de demanda × capacidade). As tabelas
(`resource_profiles`, `skills`, `user_skills`, `allocations`, `absences`, `timesheet_approvals`,
`time_entries`, `resource_requests`) e as permissões (`resources.manage`, `timesheet.approve`,
`timesheet.log`) já existiam desde o schema antecipado do Prompt 2 — este prompt entrega o motor de
cálculo (shared), a API/worker e o frontend sobre elas. Nenhuma migração de schema nova foi
necessária, só uma correção de dado de referência (`0018_webhook_manage_permission.sql`): o
catálogo de permissões estava sem `webhook.manage` desde o Prompt 10 (usado por `board_owner`, mas
nunca inserido em `public.permissions` — provisionar um tenant novo quebraria na FK de
`role_permissions`); corrigido junto nesta entrega por ter sido encontrado durante a varredura do
catálogo de permissões deste prompt.

## Decisões

### Motor de capacidade em `packages/shared`, data-only e sem fuso

- `packages/shared/src/capacity.ts` opera só sobre `WorkingCalendar` (ADR 0019) + `hoursPerDay` +
  ausências — datas são sempre strings ISO `YYYY-MM-DD` (data de negócio, sem hora), a mesma
  convenção de `business-days.ts`; **não** reaproveita `business-time.ts` (tempo útil instante-a-
  instante do SLA, Prompt 10), que resolve um problema diferente (prazo com hora, não jornada
  diária).
- `dailyCapacity` calcula, por dia: `nominalHours` (jornada se dia útil, `0` caso contrário),
  `availableHours` (nominal menos ausência do dia, nunca negativo), `allocatedHours` (soma das
  alocações que cobrem o dia) e as flags `overallocated` (alocado > disponível) e `idle` (disponível
  > 0 e nada alocado). `aggregateCapacityDays` soma esses dias por semana (segunda-feira ISO,
  `isoWeekStart`) ou mês para o heatmap e o widget, sem recalcular do zero.
- `suggestLeveling` é **guloso, não um solver ótimo**: para cada dia sobrealocado, tenta mover o
  excedente da alocação mais recente (mais fácil de adiar) para o primeiro dia seguinte com folga —
  é um ponto de partida que a pessoa revisa e aplica como uma edição normal de alocação, não uma
  mutação própria no banco.
- `monthlyBuckets` gera os baldes mensais da previsão de 3/6/12 meses a partir de hoje.

### Alocação é um construto deliberadamente desacoplado da coluna "Responsável"

- Itens não têm `assigneeId` — "Responsável" é uma coluna do tipo `people` (`{personIds, teamIds}`
  em JSONB), sem relação com `allocations`. Uma pessoa pode estar no campo "Responsável" de um item
  sem ter uma alocação formal (e vice-versa): o campo de pessoas é sobre quem faz o trabalho; a
  alocação é sobre quanto tempo/quando essa pessoa está planejada para isso, para efeito de
  capacidade. Não existe sincronização automática entre os dois nesta entrega — decisão de escopo,
  não lacuna a corrigir sem mais contexto de produto sobre o comportamento esperado.

### Cronômetro do item alimenta o timesheet; não existe um segundo cronômetro

- O cronômetro por item já existente desde o Prompt 5/7 (coluna `time_tracking`, `ItemsService
  .timer(user, itemId, columnKey, 'start'|'stop')`) gravava a duração só no valor JSONB da coluna,
  sem relação com `time_entries`. Nesta entrega, `timer(..., 'stop')` passou a **também** inserir
  uma linha em `time_entries` (`source: 'timer'`, minutos arredondados, data de hoje, `status:
  'draft'`) e emitir `time_entry.changed` — não foi criada uma UI de cronômetro paralela; o
  cronômetro do item e o apontamento semanal escrevem no mesmo lugar.
- O período de origem é checado antes de gravar: se já existe uma `timesheet_approvals` **aprovada**
  cobrindo a data, o apontamento do cronômetro é silenciosamente descartado (mesma regra de
  bloqueio de período fechado que vale para o apontamento manual) — evita que parar um cronômetro
  depois do fechamento do período reabra uma semana já aprovada.

### Horas custam dinheiro, mas o dado de custo nunca sai do perfil

- `resourceProfiles.costRateHour`/`billRateHour` existem desde o schema antecipado, mas
  **nenhum lugar desta entrega multiplica taxa × horas apontadas em um valor de custo do
  projeto** — `CapacityService` documenta explicitamente que nunca expõe essas colunas nas
  respostas de heatmap/nivelamento/what-if/previsão (dado de compensação, sensível). O apontamento
  de horas alimenta o **esforço realizado** (cada `time_entries` é consultável por item —
  `GET /v1/items/:id/time-entries`, resumido no painel do item — e por pessoa/período, exportável em
  CSV), mas **não** um rollup de custo de projeto: isso fica para o módulo de Contratos/OS/UST
  (Prompt 13), onde custo/faturamento por UST é o núcleo do escopo, e para quando uma coluna
  computada "custo realizado" fizer sentido no board. Ver também "Pendências" no roadmap.

### Permissões: duas de workspace, uma de board que segue sem uso nesta entrega

- `resources.manage` (workspace) governa perfis, skills, CRUD de alocação de qualquer pessoa, ver
  ausências/solicitações de qualquer um. `timesheet.approve` (workspace) governa a fila de
  aprovação de timesheet e decide ausências como segunda via de aprovação (um gestor de recursos OU
  um aprovador de timesheet pode decidir uma ausência — nenhuma das duas é dona exclusiva do
  fluxo). Nenhuma delas tem uma regra própria em `decide()` — são checadas como permissão de
  workspace simples, sem `ResourceRef` especial.
- Criar um apontamento de horas num item é gated por `item.update` (a mesma permissão de editar o
  item), não pela permissão de board `timesheet.log` que existe no catálogo desde o Prompt 2 —
  decisão desta entrega: "pode apontar hora em um item quem pode editar esse item" é uma regra mais
  simples e já correta sem precisar de uma permissão própria: `timesheet.log` fica no catálogo sem
  uso, poderia ser removida num prompt futuro de limpeza se nenhum caso de uso aparecer para
  diferenciá-la de `item.update`.

### Tempo real: alocação/apontamento são do board; ausência/aprovação de semana não são

- `allocation.changed`, `time_entry.changed` e `resource_request.changed` carregam `boardId` e
  entregam na room do board (o mesmo mecanismo desde o Prompt 5) — fazem sentido no contexto de "o
  board em questão". `absence.changed` e `timesheet_approval.changed` **não têm board** (uma
  ausência e uma semana de timesheet atravessam todos os boards em que a pessoa está alocada) e
  caem no fallback de broadcast por tenant do `fanout.service.ts` — o mesmo padrão já usado por
  `automation.changed`/`webhook.changed` de workspace inteiro (Prompt 10). Na prática o impacto é
  nenhum: qualquer sessão autenticada do tenant recebe o evento de qualquer forma, pela mesma room —
  a escolha era só entre "tenant" e "nenhuma room", nunca "board" (não haveria um board único
  correto para rotear uma ausência ou uma semana de timesheet que cruza vários boards).

### Frontend: página standalone de capacidade, view de board e `/timesheet`, não três telas desconexas

- A view `workload` (Kanban/Gantt-like, embutida nas abas do board) e a página standalone
  `/w/:workspaceId/capacity` reaproveitam os mesmos componentes (`capacity-heatmap.tsx`,
  `workload-view.tsx`) com um `scope: 'board' | 'workspace'` na configuração da view — o heatmap
  embutido no board filtra só as alocações daquele board; a página standalone mostra a pessoa em
  todos os boards do workspace. Perfis/skills/ausências/solicitações de recurso/what-if/previsão
  vivem só na página standalone (não fazem sentido por board).
- O apontamento semanal e a fila de aprovação de gestor entraram como abas de uma única página
  `/timesheet` (não duas rotas), e o resumo de "horas apontadas" do item ganhou uma linha compacta
  no cabeçalho do painel do item já existente — mesmo padrão de "resumo pequeno, sem tela própria"
  usado pelas preferências de notificação no Prompt 10.
- Novo widget de dashboard `capacity` (ADR 0050 já tinha o motor de widgets) é deliberadamente um
  tipo diferente do widget `workload` pré-existente desde o Prompt 9 (que conta itens por valor de
  uma coluna `people`, sem relação com o motor de capacidade): nomes parecidos, dados e tabelas
  completamente diferentes — renomear o widget antigo quebraria dashboards já salvos sem ganho
  real, então os dois convivem com nomes claros na tela de configuração.

## Consequências

- Nenhuma tabela nova (schema já existia); só a correção de dado de referência do `webhook.manage`
  do Prompt 10, trazida junto por ter sido encontrada nesta varredura.
- `timesheet.log` (board) permanece uma permissão do catálogo sem nenhum consumidor — candidata a
  remoção futura se não aparecer um caso de uso que precise diferenciá-la de `item.update`.
- Lacuna conhecida e deliberada para um prompt futuro: horas apontadas não geram custo realizado de
  projeto (taxa × hora nunca é multiplicada em nenhum rollup) — fica para o módulo de Contratos/
  OS/UST (Prompt 13) ou para quando um rollup de custo por board for modelado.
- `suggestLeveling` é heurístico (guloso), não um otimizador — pode não encontrar a melhor
  redistribuição possível em cenários com muitas alocações concorrentes; é apresentado como
  sugestão revisável, nunca aplicado automaticamente.
- Alocação e a coluna "Responsável" (`people`) permanecem sem sincronização — um relatório que
  cruze "quem está no item" com "quem está alocado" pode divergir; aceito como decisão de escopo.
