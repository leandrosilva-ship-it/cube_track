# Capacity, Recursos e Timesheet

Referência de perfis de recurso, alocação, ausências, apontamento de horas (timesheet) e motor de
capacidade (Prompt 11). Decisões de arquitetura em `docs/adr/0052-capacity-recursos-e-timesheet.md`.

## 1. Modelo de dados

Tabelas em `packages/db/src/schema/resources.ts`, todas `tenant_id` + RLS, existentes desde o
schema antecipado do Prompt 2 (nenhuma migração nova neste prompt):

| Tabela                | Campos principais                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `resource_profiles`    | `userId` (único por tenant), `jobTitle`, `department`, `managerId`, `capacityHoursPerWeek` (0–168), `costRateHour`/`billRateHour`, `workCalendarId`, `location` |
| `skills`               | `name` (único por tenant, case-insensitive), `category`                                              |
| `user_skills`          | `userId` + `skillId` (único), `level` 1–5                                                            |
| `allocations`          | `userId`, `boardId`, `itemId` (opcional), `startDate`/`endDate`, `hoursPerDay` (0–24), `status: 'tentative'\|'confirmed'`, `notes` |
| `absences`             | `userId`, `type: 'vacation'\|'sick_leave'\|'training'\|'day_off'\|'other'`, `startDate`/`endDate`, `hoursPerDay` (null = dia inteiro), `status` (fluxo de aprovação), `approvedBy`/`approvedAt` |
| `timesheet_approvals`  | `userId` + `periodStart` (único — uma linha por semana), `periodEnd`, `status`, `totalMinutes`, `submittedAt`, `reviewedBy`/`reviewedAt`, `comment` |
| `time_entries`         | `userId`, `boardId`, `itemId`, `entryDate`, `minutes` (1–1440), `description`, `isBillable`, `source: 'manual'\|'timer'\|'import'\|'api'`, `startedAt`/`endedAt`, `status`, `approvalId` |
| `resource_requests`    | `boardId`, `itemId`/`skillId` (opcionais), `roleTitle`, `hours`, `startDate`/`endDate`, `status: 'open'\|'fulfilled'\|'cancelled'`, `assignedUserId`, `notes` |

`status` de `absences`/`time_entries`/`timesheet_approvals` reaproveita o mesmo enum
`approval_status` (`draft`/`submitted`/`approved`/`rejected`) já usado pelas aprovações do painel do
item (Prompt 7).

**Calendário efetivo de uma pessoa** (`packages/db/src/calendar.ts#loadPersonWorkingCalendar`):
calendário do `resource_profiles.workCalendarId` → calendário padrão do tenant → segunda–sexta sem
feriados — mesma cadeia de fallback do calendário de board (`loadWorkingCalendar`), ancorada no
perfil em vez do board.

**Alocação é desacoplada da coluna "Responsável"**: itens não têm `assigneeId`; "Responsável" é uma
coluna `people` (JSONB `{personIds, teamIds}`) sem relação com `allocations`. Uma pessoa pode estar
no campo "Responsável" sem alocação formal, e vice-versa — decisão de escopo, não sincronizada nesta
entrega.

## 2. Motor de capacidade (`packages/shared/src/capacity.ts`)

Datas são sempre strings ISO `YYYY-MM-DD` (data de negócio, sem fuso) — mesma convenção de
`business-days.ts` (ADR 0019); não usa `business-time.ts` (tempo útil instante-a-instante do SLA,
Prompt 10), que resolve um problema diferente.

- **`dailyCapacity`**: por dia, calcula `nominalHours` (jornada se dia útil do calendário, `0` caso
  contrário), `availableHours` (nominal menos horas de ausência naquele dia, nunca negativo),
  `allocatedHours` (soma das alocações que cobrem o dia) e as flags `overallocated`
  (`allocatedHours > availableHours`) e `idle` (`availableHours > 0` e nada alocado).
- **`aggregateCapacityDays`**: agrega os dias por semana (segunda-feira ISO, `isoWeekStart`) ou mês,
  para o heatmap e o widget de dashboard.
- **`suggestLeveling`**: sugestão **gulosa, não um solver ótimo** — para cada dia sobrealocado,
  tenta mover o excedente da alocação mais recente (mais fácil de adiar) para o primeiro dia
  seguinte com folga, dentro da janela consultada. A pessoa revisa e aplica como uma edição normal
  de alocação; não é uma mutação automática no banco.
- **`monthlyBuckets`**: baldes mensais a partir de hoje, para a previsão de 3/6/12 meses.

## 3. API

Dois módulos novos: `apps/api/src/modules/resources/` e `apps/api/src/modules/timesheet/`.

### Recursos (`resources.controller.ts`)

| Rota                                            | Permissão                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `GET teams`                                       | sessão autenticada (lista times do tenant, para agrupar por time)     |
| `GET/PUT resource-profiles`, `users/:id/resource-profile` | leitura: `resources.manage` ou a própria pessoa; escrita: `resources.manage` |
| `GET/POST/PATCH/DELETE skills`, `users/:id/skills`       | `resources.manage`                                                |
| `GET/POST/PATCH/DELETE allocations`, `boards/:id/allocations`, `users/:id/allocations` | `resources.manage` (de terceiros) ou a própria pessoa (`board.read` para ver as do board) |
| `GET absences/pending`, `users/:id/absences`, `POST absences`, `POST absences/:id/decide`, `DELETE` | criar/ver as próprias: sessão autenticada; listar pendentes/decidir: `resources.manage` **ou** `timesheet.approve` |
| `GET/POST resource-requests`, `boards/:id/resource-requests`, `POST .../assign`, `POST .../cancel` | criar/cancelar: `board.manage`; listar: `board.read`; atender (`assign`): `resources.manage` |
| `GET capacity/heatmap`, `capacity/leveling-suggestions`, `POST capacity/what-if` | `resources.manage` **ou** ver só a própria pessoa no escopo          |
| `GET capacity/forecast`                           | `resources.manage`                                                |

### Timesheet (`timesheet.controller.ts`)

| Rota                                                              | Permissão                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `GET users/:id/time-entries`, `items/:id/time-entries`                | a própria pessoa, ou `item.read` do item               |
| `POST time-entries`, `POST time-entries/week`, `PATCH/DELETE time-entries/:id` | `item.update` do item (não a permissão de board `timesheet.log` do catálogo, não usada nesta entrega) |
| `GET users/:id/time-entries/export.csv`                               | a própria pessoa, ou `timesheet.approve`               |
| `GET users/:id/timesheet-approvals`, `POST timesheet-approvals/submit` | a própria pessoa                                       |
| `GET timesheet-approvals/pending`, `POST timesheet-approvals/:id/decide` | `timesheet.approve`                                  |

**Bloqueio de período fechado**: criar/editar um `time_entries` falha se já existe uma
`timesheet_approvals` **aprovada** cobrindo a `entryDate` — vale tanto para o apontamento manual
quanto para o gerado pelo cronômetro do item (abaixo).

**Cronômetro do item alimenta o timesheet**: o cronômetro por item já existente desde o Prompt 5/7
(coluna `time_tracking`, `ItemsService.timer(user, itemId, columnKey, 'start'|'stop')`) agora, ao
parar (`'stop'`), também insere uma linha em `time_entries` (`source: 'timer'`, minutos
arredondados, data de hoje, `status: 'draft'`) e emite `time_entry.changed` — não existe uma UI de
cronômetro paralela; o cronômetro do item e o apontamento semanal escrevem no mesmo lugar. Se o
período já estiver aprovado, o apontamento do cronômetro é descartado silenciosamente (mesma regra
de bloqueio acima).

**Dado de custo nunca sai do perfil**: `CapacityService` nunca inclui `costRateHour`/`billRateHour`
nas respostas de heatmap/nivelamento/what-if/previsão — são dados de compensação, sensíveis. O
apontamento de horas alimenta o **esforço realizado** por item (`GET .../items/:id/time-entries`,
resumido no painel do item) e por pessoa/período (exportável em CSV), mas **não** multiplica taxa ×
hora em nenhum rollup de custo de projeto nesta entrega — ver §6.

## 4. Frontend

| Tela                                            | Onde                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Perfis/skills, ausências, solicitações de recurso  | `apps/web/src/features/resources/{resource-profiles-panel,absences-panel,resource-requests-panel}.tsx`, abas da página standalone |
| Workload/Capacity (heatmap, what-if, previsão)     | `workload-view.tsx` + `capacity-heatmap.tsx` + `what-if-panel.tsx` + `forecast-panel.tsx`, reaproveitados tanto pela view `workload` do board quanto pela página standalone |
| Nova alocação (heatmap → diálogo)                  | `new-allocation-dialog.tsx`                                                             |
| Página standalone de capacidade                   | `/w/:workspaceId/capacity` (`capacity-page.tsx`), link no cabeçalho do workspace          |
| View `workload` embutida no board                 | `view-body.tsx` (`if (view.type === 'workload') return <WorkloadView .../>`), criável nas abas como Kanban/Gantt |
| Apontamento semanal + fila de aprovação            | `/timesheet` (`timesheet-page.tsx`): aba "Minha semana" (`weekly-grid.tsx`) + aba "Aprovações" (`approval-queue.tsx`) |
| Resumo de horas no painel do item                  | `item-time-summary.tsx`, linha compacta no cabeçalho do painel do item já existente        |
| Widget de dashboard `capacity`                     | `widget-card.tsx`/`widget-dialog.tsx`/`model.ts` — heatmap compacto, agrupável por pessoa/time/skill |

A view `workload` e a página standalone reaproveitam os mesmos componentes de heatmap com um
`scope: 'board' | 'workspace'` na configuração da view: embutida no board, filtra só as alocações
daquele board; na página standalone, mostra a pessoa em todos os boards do workspace.

**Widget `capacity` ≠ widget `workload`**: o widget `workload` já existia desde o Prompt 9 e conta
itens por valor de uma coluna `people` — não tem relação com o motor de capacidade. O widget
`capacity` (novo) lê `resource_profiles`/`allocations`/`absences` diretamente. Nomes parecidos,
dados completamente diferentes — mantidos como dois tipos para não quebrar dashboards já salvos com
o widget antigo.

## 5. Tempo real

`packages/shared/src/events.ts`, documentados também em `docs/realtime-events.md` §4:

| Evento                       | Room             | Payload                                                                 |
| ------------------------------ | ------------------ | -------------------------------------------------------------------------- |
| `allocation.changed`           | board              | `{allocationId, userId, boardId, itemId, change}`                          |
| `absence.changed`              | tenant             | `{absenceId, userId, change}`                                              |
| `time_entry.changed`           | board              | `{timeEntryId, userId, boardId, itemId, change}`                           |
| `timesheet_approval.changed`   | tenant             | `{approvalId, userId, periodStart, status}`                                |
| `resource_request.changed`     | board              | `{requestId, boardId, change}`                                             |

`allocation.changed`/`time_entry.changed`/`resource_request.changed` carregam `boardId` e entregam
na room do board (mesmo mecanismo desde o Prompt 5). `absence.changed`/`timesheet_approval.changed`
não têm board (uma ausência ou uma semana de timesheet cruza todos os boards em que a pessoa está
alocada) e caem no broadcast por tenant — mesmo padrão de `automation.changed`/`webhook.changed` de
workspace inteiro (Prompt 10).

## 6. Escopo cortado nesta entrega (documentado, não escondido)

- **Custo de projeto**: `resourceProfiles.costRateHour`/`billRateHour` existem, mas nenhum rollup
  multiplica taxa × horas apontadas em um custo de projeto — fica para o módulo de Contratos/OS/UST
  (Prompt 13) ou para quando um rollup de custo por board for modelado.
- **Alocação × "Responsável"**: sem sincronização entre `allocations` e a coluna `people` do item —
  um relatório que cruze os dois pode divergir.
- **`timesheet.log`** (permissão de board do catálogo desde o Prompt 2) não é usada nesta entrega —
  apontar horas usa `item.update`.
- **Nivelamento é heurístico**: `suggestLeveling` é guloso, não um otimizador — pode não achar a
  melhor redistribuição possível com muitas alocações concorrentes.
- **Testes de integração (API/worker) e E2E Playwright**: escritos nesta entrega mas **não
  executados neste ambiente** (sandbox sem Postgres/Redis/Docker) — mesma limitação documentada
  desde o Prompt 3.

## 7. Como rodar e testar

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay + notificações de ausência/timesheet/solicitação
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm --filter @cube-track/shared test    # motor de capacidade (capacity.test.ts)
pnpm --filter @cube-track/web test       # modelos de recursos/timesheet, apply.ts
pnpm --filter @cube-track/api test       # resources.e2e.test.ts, timesheet.e2e.test.ts
pnpm --filter @cube-track/worker test    # notificações de capacidade/timesheet (processors.e2e.test.ts)
pnpm --filter @cube-track/web test:e2e   # fluxos de alocação/sobrealocação, ausência, apontamento/aprovação
```
