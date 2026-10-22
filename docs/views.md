# Views, Kanban e link público

Referência das views salvas de um board: tipos, configuração, governança, duplicação, link público somente leitura e filtros salvos. A fonte da verdade do contrato é `packages/shared/src/views.ts` (schemas Zod de `config`/`sort`/`groupBy`), consumida igual pela API (`apps/api/src/modules/structure/`) e pelo web.

## 1. Tipos de view

| Tipo        | Tela própria           | Config (`views.config`)              |
| ----------- | ----------------------- | ------------------------------------- |
| `table`     | sim (Prompt 5)           | `TableConfigSchema` (ordem/largura/fixação/colunas recolhidas por chave) |
| `kanban`    | sim (Prompt 6)           | `KanbanConfigSchema` (ver §2)         |
| `calendar`  | sim (Prompt 8)           | `CalendarConfigSchema` (ver §3)       |
| `timeline`  | sim (Prompt 8)           | `TimelineConfigSchema` (ver §4)       |
| `gantt`     | sim (Prompt 8)           | `GanttConfigSchema` (ver §5)          |
| `form`      | sim (Prompt 8)           | `FormViewConfigSchema` (ver §6)       |
| `map`       | "em breve" (Prompt 15+)  | genérico                              |
| `chart`     | "em breve" (Prompt 9)    | genérico                              |
| `files`     | "em breve" (Prompt 7)    | genérico                              |
| `workload`  | "em breve" (Prompt 11)   | genérico                              |
| `dashboard` | "em breve" (Prompt 9)    | genérico                              |

`IMPLEMENTED_VIEW_TYPES` (em `views.ts`) decide quais tipos ganham tela própria; os demais caem na mesma UX "módulo não habilitado" usada por Integrar/Automatizar/Agentes. Views desses tipos continuam existindo, podem ser criadas/renomeadas/reordenadas e aparecem como aba desabilitada até o prompt correspondente.

## 2. Kanban (`KanbanConfigSchema`)

```ts
{
  columnsBy: string;       // 'group' ou chave de coluna status/lista/pessoas/caixa/tags (padrão: 'group')
  swimlanesBy?: string;    // 'group' ou chave de coluna; ausente = sem raias
  cardFields: string[];    // chaves de coluna mostradas no cartão (até 12)
  cardDensity: 'compact' | 'detailed'; // padrão 'detailed'
  showCover: boolean;      // padrão false — primeiro anexo de imagem como capa
  colorBy?: string;        // chave de coluna status/dropdown/caixa usada para colorir o cartão
  wipLimits: Record<string, number>; // limite por valor da coluna de columnsBy (chave = labelId/optionId/'group:<id>')
  wipBlock: boolean;       // padrão false — true bloqueia o drop acima do limite, false só avisa
  hideEmptyColumns: boolean; // padrão false
  collapsedColumnKeys: string[]; // colunas recolhidas (lembradas por usuário? não — são da view)
}
```

- `columnsBy`/`swimlanesBy` aceitam **status, lista suspensa, pessoas, caixa de seleção ou tags**; pessoas/tags geram uma coluna por pessoa/tag (e uma "Sem atribuição"); caixa de seleção gera duas colunas (Sim/Não).
- **WIP é decisão só de interface** (ADR 0045): `wipLimits`/`wipBlock` vivem na config da própria view Kanban, não em `column_definitions` nem em nenhuma tabela — duas views Kanban do mesmo board podem ter limites diferentes, e o servidor nunca rejeita uma escrita por estourar o limite.
- Cartões mostram agregados no cabeçalho de cada coluna (contagem; soma de UST/horas quando `cardFields` inclui uma coluna numérica com essas unidades).

### Arrastar-e-soltar (ADR 0045)

| Ação                                   | Chamada à API                                                      |
| --------------------------------------- | -------------------------------------------------------------------- |
| Mover de coluna (`columnsBy`)           | `PATCH /v1/items/:id` com `values.<chave> = <novo valor>`            |
| Mover de raia (`swimlanesBy = 'group'`) | `PATCH /v1/items/:id` com `groupId`                                  |
| Reordenar na mesma coluna/raia          | `PATCH /v1/items/:id` com `afterId`/`beforeId`                       |

Não existe um endpoint "mover cartão" separado: é o mesmo `item-writer` da Tabela, então drag-and-drop já respeita permissão de coluna, obrigatoriedade condicional (abre o diálogo "Campos obrigatórios" quando falta algo) e transições de status (abaixo) sem código duplicado.

## 3. Calendário (`CalendarConfigSchema`)

```ts
{
  dateColumnKey: string;           // padrão 'plannedStartDate'; coluna/campo nativo que posiciona o item no dia
  secondaryDateColumnKey?: string; // 2ª data mostrada junto (ex.: término replanejado ao lado do planejado)
  colorBy?: string;                // normalmente a coluna de status
  defaultView: 'month' | 'week' | 'day'; // padrão 'month'
}
```

- Tela própria com as três visões (mês/semana/dia); troca de visão é estado local do componente (não grava `config` a cada clique — só `defaultView` quando o usuário fixa a visão inicial nas configurações da view).
- Reaproveita `GET /v1/boards/:boardId/items` (mesmo endpoint da Tabela/Kanban) filtrando no cliente pelos itens com `dateColumnKey` preenchido no mês/semana/dia visível; nenhum endpoint novo.
- Arrastar um item para outro dia grava `PATCH /v1/items/:id` em `dateColumnKey` (e, se `secondaryDateColumnKey` estiver configurada e o item tiver as duas datas, desloca as duas pelo mesmo número de dias, preservando a duração). Mesma validação de permissão de coluna e obrigatoriedade condicional da Tabela — nenhum atalho.
- Clicar num dia vazio abre a criação rápida de item já com `dateColumnKey` preenchida com aquele dia.
- Cores seguem `colorBy` (rótulo de status/opção); sem `colorBy`, usa a cor do grupo do item.

## 4. Timeline/Roadmap (`TimelineConfigSchema`)

```ts
{
  startColumnKey: string; // padrão 'plannedStartDate'
  endColumnKey: string;   // padrão 'plannedEndDate'
  groupBy: string;        // 'group', coluna de pessoas ou outra coluna de agrupamento — padrão 'group'
  colorBy?: string;
  zoom: 'day' | 'week' | 'month' | 'quarter' | 'year'; // padrão 'month'
  showMilestones: boolean; // padrão true
  showToday: boolean;      // padrão true
}
```

- Barras por intervalo (`startColumnKey`..`endColumnKey`), uma raia por valor de `groupBy`; suporta **múltiplos boards/projetos na mesma tela** quando a view vive num portfólio (fora do escopo desta entrega: aqui a timeline é por board, como as demais views).
- Eixo de datas e zoom vêm de `packages/shared/src/timeline.ts` (`buildTicks`, `dateToX`/`xToDate`, `defaultRange`) — a mesma escala é reaproveitada pelo Gantt (§5); zoom troca só `pxPerDay`, não recarrega dados.
- `showMilestones`: desenha os marcos do board (`GET /v1/boards/:boardId/milestones`, §5.3) como losangos na raia do item vinculado (ou numa raia "Marcos" quando sem item).
- `showToday`: linha vertical no dia atual (fuso do tenant).
- Também reaproveita `GET /v1/boards/:boardId/items`; não tem endpoint próprio.

## 5. Gantt/Cronograma (`GanttConfigSchema`, ADR 0049)

```ts
{
  startColumnKey: string; // padrão 'plannedStartDate' (informativo — o Gantt sempre usa a data vigente: replanejado se houver, senão planejado)
  endColumnKey: string;   // padrão 'plannedEndDate'
  groupBy: 'group' | 'none'; // padrão 'group'
  showCriticalPath: boolean; // padrão false
  showWbs: boolean;          // padrão true
  baselineCompare: boolean;  // padrão false
  baselineId?: string;       // baseline comparada; ausente + baselineCompare usa a primária do board
  zoom: 'day' | 'week' | 'month' | 'quarter' | 'year'; // padrão 'week'
}
```

Único endpoint, único round-trip: **`GET /v1/boards/:boardId/gantt`** devolve tudo que a tela precisa —

```ts
{
  tasks: {
    id, parentItemId, groupId, name,
    wbs: string | null,          // "1.2.3" — ver §5.1
    plannedStartDate, plannedEndDate, replannedStartDate, replannedEndDate,
    actualStartDate, actualEndDate,
    start, end,                  // datas vigentes (replanejado se houver, senão planejado) — o que a barra desenha
    progress, isMilestone, scheduleMode: 'auto' | 'manual',
  }[],
  dependencies: { id, predecessorId, successorId, type: 'FS'|'SS'|'FF'|'SF', lagDays }[],
  criticalPath: { id, earlyStart, earlyFinish, lateStart, lateFinish, totalFloatDays, isCritical }[],
  calendar: { workingDays: number[], holidays: string[] }, // calendário de dias úteis vigente (para a UI desenhar fins de semana/feriados)
}
```

### 5.1 Numeração EAP/WBS (`packages/shared/src/wbs.ts`)

Derivada, nunca persistida: um nível por **grupo** (ordenado por posição) seguido da hierarquia item→subitem (também por posição), recursiva. `computeWbsNumbers(groups, items)` é pura e testada (`wbs.test.ts`); o mesmo board sempre produz a mesma numeração enquanto grupos/itens não mudarem de posição.

### 5.2 Caminho crítico (CPM, `packages/shared/src/scheduling.ts`)

`computeCriticalPath(tasks, links, calendar)`: passada de frente (datas já consistentes do cronograma vigente) + passada de trás (fim do projeto = maior data de término entre todas as tarefas datadas); folga total = diferença em dias úteis entre início cedo e início tarde. **`isCritical` quando a folga é ≤ 0** (zero ou negativa — negativa indica uma cadeia já atrasada). Recalculado a cada chamada do endpoint (sempre consistente com o estado atual, sem cache); o servidor já devolve pronto — a tela só pinta `isCritical` em vermelho/destaque, sem recalcular nada no cliente. `showCriticalPath` na config só liga/desliga o destaque visual.

### 5.3 Marcos (`milestones`, distintos de `isMilestone`)

Duas coisas coexistem: o item pode ter `isMilestone: true` (desenha como losango de duração zero no Gantt, sem mudar a tarefa de outra forma) **e** existir um registro em `milestones` (nome, data-alvo, status `pending|achieved|missed|cancelled`, opcionalmente ligado a um item) — um é "este item é um ponto zero no cronograma", o outro é "este marco de negócio existe e tem um status próprio", e nem todo marco de negócio precisa de um item.

| Rota                                  | Permissão         | Observação |
| --------------------------------------- | ------------------- | ------------ |
| `GET /v1/boards/:boardId/milestones`  | `board.read`       | ordenado por `dueDate` |
| `POST /v1/boards/:boardId/milestones` | `schedule.manage`  | `itemId` opcional (deve pertencer ao board) |
| `PATCH /v1/milestones/:id`            | `schedule.manage`  | `status: 'achieved'` grava `achievedAt = now()` automaticamente; qualquer outro status zera `achievedAt` |
| `DELETE /v1/milestones/:id`           | `schedule.manage`  | exclusão lógica |

Toda mudança emite `milestone.changed` (`{ milestoneId, boardId, change: 'created'|'updated'|'deleted' }`) — a tela recarrega a lista de marcos do board inteiro ao receber o evento (payload enxuto de propósito).

### 5.4 Baselines (planejado × replanejado × realizado)

Duas formas de comparação coexistem: as colunas nativas do item (`plannedStart/EndDate`, `replannedStart/EndDate`, `actualStart/EndDate`, já na Tabela/Gantt) cobrem "planejado × replanejado × realizado" **no instante atual**; uma **baseline** é uma fotografia nomeada e datada do planejado de todos os itens ativos do board, para comparar contra o estado atual **meses depois**.

| Rota                                   | Permissão         | Observação |
| ----------------------------------------- | ------------------- | ------------ |
| `GET /v1/boards/:boardId/baselines`    | `board.read`       | `{ id, name, description, capturedAt, isPrimary }[]` |
| `POST /v1/boards/:boardId/baselines`   | `schedule.manage`  | captura `plannedStartDate/plannedEndDate/progress` de todo item ativo (não arquivado/excluído) do board |
| `GET /v1/baselines/:id`                | `board.read`       | detalhe + `items[]` comparando `baseline{Start,End}Date` × `planned/replanned/actual*Date` atuais, por item |
| `POST /v1/baselines/:id/primary`       | `schedule.manage`  | marca como primária do board (desmarca a anterior na mesma transação) |
| `DELETE /v1/baselines/:id`             | `schedule.manage`  | exclusão lógica |

`baselineCompare` + `baselineId` (ou a baseline primária, se ausente) desenha uma segunda barra, mais fina, atrás da barra do cronograma vigente — o desvio visual é a distância entre as duas. Evento `baseline.changed` (`{ baselineId, boardId, change: 'captured'|'primary_changed'|'deleted' }`).

### 5.5 Modo de agendamento manual (`scheduleMode`, ADR 0049)

Todo item tem `scheduleMode: 'auto' | 'manual'` (padrão `'auto'`), editável como qualquer campo nativo via `PATCH /v1/items/:id` (`{ scheduleMode: 'manual' }`, sem aninhar em `fields`). Um item **manual nunca é empurrado** pelo recálculo de dependências do worker (o vínculo em que ele é sucessor é ignorado no recálculo) — mas continua **constrangendo normalmente as próprias sucessoras**, com as datas que já tem. Use para uma tarefa com data fixa por contrato/licitação que não deve se mover só porque um predecessor atrasou.

### 5.6 Recálculo automático (push, nunca pull)

Mudar `plannedStartDate`/`plannedEndDate`/`replannedStartDate`/`replannedEndDate` de um item, ou adicionar/editar/remover um predecessor seu (`SetDependenciesBody`, Prompt 7), publica `item.updated` com o campo mudado; o worker (`apps/worker/src/processors/schedule.ts`) recalcula **só os sucessores alcançáveis** a partir do item que mudou, respeitando FS/SS/FF/SF + lag em dias úteis e o calendário vigente do board — **só empurra para depois, nunca antecipa** uma sucessora (ADR 0049 segue a convenção padrão de ferramentas de cronograma). Cada sucessor movido grava nova versão, auditoria `item.rescheduled`, atividade e um novo `item.updated` (tempo real) — o cliente só precisa reagir normalmente a `item.updated` de qualquer item do board e, se a tela do Gantt estiver aberta, recarregar `GET /v1/boards/:boardId/gantt` (o caminho crítico também muda).

### 5.7 Calendário de dias úteis

`GET /v1/boards/:boardId/gantt` devolve `calendar.workingDays`/`calendar.holidays` já resolvidos (board → padrão do tenant → `[1,2,3,4,5]` sem feriados) a partir da data mais antiga do cronograma — a mesma função (`loadWorkingCalendar`) usada pelo worker para recalcular. A tela desenha fins de semana/feriados sombreados usando esses mesmos valores, nunca recalcula o calendário por conta própria.

### 5.8 Importação de cronograma MS Project (`.xml`/MSPDI)

`.mpp` (binário proprietário da Microsoft) **não é suportado** — o prompt permite explicitamente pular esse formato; só o XML MSPDI exportado pelo MS Project (`Arquivo > Salvar como > XML`) é aceito.

| Rota                                                              | Corpo / resposta |
| -------------------------------------------------------------------- | ------------------- |
| `POST /v1/boards/:boardId/schedule-imports`                       | `{ fileName, contentBase64 }` → prévia (`{ importId, totalTasks, sample, dependencyCount, warnings }`), válida por 30 min (Redis, mesmo padrão da importação de planilha) |
| `POST /v1/boards/:boardId/schedule-imports/:importId/commit`      | `{ groupId }` → `{ created, skipped, dependenciesCreated, errors }` |

Cada `<Task>` vira um item de topo no grupo escolhido (`Name` → nome, `Start`/`Finish` → planejado, `Milestone=1` → `isMilestone`); a tarefa 0 (projeto inteiro, implícita em todo MSPDI) é sempre ignorada. Cada `<PredecessorLink>` vira uma dependência (`Type` 0/1/2/3 → `FF`/`FS`/`SF`/`SS`, convenção MSPDI padrão da indústria; `LinkLag` em décimos de minuto é convertido para dias úteis assumindo jornada de 8h, arredondado). **A hierarquia de subitens (Outline Level) não é reconstruída nesta versão** — todas as tarefas entram como itens de topo; reorganizar em subitens é manual, depois da importação.

## 6. Formulários (`FormViewConfigSchema`, ADR 0049)

```ts
{ formId?: string } // a view só referencia o formulário — ele é a fonte da verdade, não a view
```

Formulário (`forms`/`form_fields`/`form_submissions`) cria itens num board/grupo a partir de respostas, com lógica condicional ("mostrar quando") e duas formas de preenchimento: **público** (token + captcha, sem login) ou **interno** (autenticado, sem token).

### 6.1 CRUD autenticado (requer `form.manage` no board para escrever; `board.read` para listar/ver)

| Rota                                       | Observação |
| --------------------------------------------- | ------------ |
| `GET/POST /v1/boards/:boardId/forms`       | criar começa sem campos — adicionados em seguida |
| `GET/PATCH/DELETE /v1/forms/:id`           | `settings` é a marca do formulário: `{ logoUrl, primaryColor, thankYouMessage, redirectUrl }` |
| `POST /v1/forms/:id/public-link`           | `{ isPublic }` — emite (token novo, em claro **só nesta resposta**) ou revoga o link público |
| `GET/POST /v1/forms/:id/fields`            | campo = `{ columnKey, label, helpText, fieldType, isRequired, showWhen, settings, position }` |
| `PATCH/DELETE /v1/form-fields/:id`         | — |

- `columnKey`: chave de coluna real do board, **ou** os valores reservados `'name'`/`'description'` (campos nativos do item), **ou** ausente (resposta fica só em `form_submissions.data`, nunca vira campo do item).
- `fieldType` é **derivado no servidor**, não aceito do cliente: para `columnKey` real, é sempre o tipo atual da coluna (status, dropdown, pessoas, data…); para `name`/`description`/ausente, é um dos tipos "nativos" (`text`, `long_text`, `email`, `phone`, `number`, `date`, `checkbox`) informado na criação.
- **Coluna vinculada a um campo nativo (`binding` não nulo, ex.: a coluna "Prazo" ligada a `item.planned_end_date`) não pode ser mapeada num formulário** (`422 column_bound`) — escreve-se pelo campo nativo correspondente, não por `values`; fora de escopo desta versão.
- `showWhen` reaproveita **a mesma AST e o mesmo avaliador** de `requiredWhen` (ADR 0039, `matchesFilter`) — "mostrar quando" é avaliado exatamente como "obrigatório quando" já era para colunas. Um campo obrigatório que está oculto por `showWhen` não bloqueia o envio.

### 6.2 Envio público (sem login)

1. `GET /v1/public/forms/:token` → definição (nome, descrição, marca, campos com tipo/rótulos/opções resolvidos, e `requiresLogin`). Quando `requiresLogin: false`, a resposta também traz `captcha: { token, question }` — um desafio de soma (“Quanto é 3 + 5?”) **auto-emitido** (HMAC assinado, sem terceiros, válido por 10 min, sem estado no banco); não há integração de captcha externa nesta versão.
2. `POST /v1/public/forms/:token/submit` com `{ answers: { [fieldId]: resposta }, honeypot?, captcha?: { token, answer } }`. Sem login: `honeypot` deve chegar **vazio** (um campo armadilha invisível ao usuário humano; preenchido ⇒ `422 submission_rejected`, resposta deliberadamente genérica) e `captcha` deve resolver corretamente (`422 captcha_invalid`). Com login (`requiresLogin: true`): a mesma rota aceita um `Authorization: Bearer` normal — presente, vira o autor do item e dispensa captcha/honeypot; ausente, `401 form_login_required`. O token nunca pode resolver para um tenant diferente do usuário autenticado (`403 tenant_mismatch`).
3. Sucesso cria o item (`{ itemId, branding }`) e grava `form_submissions` (resposta bruta, IP, user agent, autor se houver) — o item aparece **em tempo real** no board (evento `item.created` normal, roteado pelo board) para quem estiver com a Tabela/Kanban/Gantt abertos.

A autorização do envio público é **o próprio link** (token + captcha/login, conforme o caso) — não checa `item.create` nem permissão de coluna; quem o formulário alcança é quem o board_owner decidiu ao publicar o link.

### 6.3 Preenchimento interno (autenticado, sem link)

`POST /v1/forms/:id/submit` com `{ answers }` — exige `item.create` no board (mesma permissão da criação normal de item pela Tabela); os valores de coluna passam pela **mesma validação de permissão por coluna** do `item-writer` (ao contrário do caminho público, que não checa permissão de coluna).

## 7. Transições de status (ADR 0046)

Coluna do tipo `status` pode ter `settings.transitions: { [rótuloOrigemId]: [rótuloDestinoId, ...] }` (até 50 destinos por origem), editável via `PATCH /v1/boards/:boardId/columns/:columnId` (campo `settings`, mesma rota do Prompt 5). Sem regra configurada para o rótulo de origem, a mudança é livre. A regra é imposta no servidor (`422 invalid_transition`) em qualquer escrita de item — Tabela, Kanban, importação — porque vive no `item-writer`, não numa tela. Ver `packages/shared/src/columns/registry.ts` (`isTransitionAllowed`).

## 8. Filtros, ordenação e agrupamento

- `filters`: a mesma AST `{ op: 'and'|'or', conditions: [...] }` do resto do produto (`FilterGroupSchema`, ADR 0005) — inclusive os tokens de data (`today`, `this_week`, `overdue`…) e `me` para colunas de pessoas.
- `sort`: lista de até 3 `{ columnKey, direction }`; `viewSortToQueryString` converte para o parâmetro `field:dir` usado pela listagem de itens.
- `groupBy`: até 3 níveis (`'group'` ou chave de coluna) — mesma convenção da Tabela.
- `hiddenColumnKeys`: colunas ocultas **desta view**, além da redação por permissão de coluna (que vale em toda superfície, inclusive link público).

## 9. Governança (ADR 0044)

- **Pessoal** (`ownerId` preenchido): só o dono lê, edita ou exclui; não entra na contagem de padrão do board.
- **Compartilhada** (`ownerId` nulo): qualquer um com `board.read` lê; editar exige `view.manage`. `isDefault`, `isLocked` e `isRestricted` só mudam com `view.manage`, mesmo que o usuário já pudesse editar a view por outro motivo.
- No máximo **uma view padrão** por dono (pessoal) ou por board (compartilhada) — marcar uma nova padrão desmarca a anterior do mesmo escopo, na mesma transação.
- A view padrão **não pode ser excluída** (`400`).
- `isRestricted`: view compartilhada visível só a quem tem concessão explícita ou gerencia o board (além de `board.read`).

### Duplicar

`POST /v1/views/:id/duplicate` copia tipo, `config`, `filters`, `sort`, `groupBy` e `hiddenColumnKeys` para uma view nova e **independente** — editar a cópia nunca muda a original. Nasce não padrão, não bloqueada e não restrita; `personal` pode ser escolhido na duplicação (padrão: mesma visibilidade da origem).

## 10. Link público (ADR 0047)

Link somente leitura de uma **view específica** (não do board inteiro), com senha e expiração opcionais. Gerenciar exige `board.share` no board da view.

### Gerenciamento (autenticado)

| Rota                              | Corpo / resposta                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /v1/views/:id/share-link`     | status: existe, exige senha, expiração, revogado, contagem e data do último acesso, colunas ocultas, busca |
| `PUT /v1/views/:id/share-link`     | cria ou atualiza: `password` (`null` remove), `expiresAt` (`null` remove), `hiddenColumnKeys`, `allowSearch`, `regenerateToken`. **O token em claro só volta na resposta quando `regenerateToken: true`** (ou na primeira criação) — não é recuperável depois, como os links de convite |
| `DELETE /v1/views/:id/share-link`  | revoga (mantém `access_count`/`last_accessed_at` para auditoria, não apaga a linha)                     |

### Acesso público (sem autenticação)

1. `GET /v1/public/share/:token/info` → `{ requiresPassword }`, sem criar sessão.
2. `POST /v1/public/share/:token/verify` → `{ password? }`; devolve `{ shareToken, boardId, viewId, expiresInSeconds }`. `shareToken` é um JWT próprio (`typ: share+jwt`, 1h) — não confundir com o token do link nem com o access token da conta.
3. `GET /v1/public/share/board` e `GET /v1/public/share/items` exigem o cabeçalho **`X-Share-Session: <shareToken>`** (nunca `Authorization`, para não colidir com o guard de login).

Qualquer falha (token inexistente, revogado, expirado, senha errada) responde `401 share_link_invalid` — sem distinguir os casos, para não permitir enumerar links por tentativa e erro.

### Redação e limites (escopo desta entrega)

- Colunas ocultas: união de `views.hiddenColumnKeys` com `share_links.settings.hiddenColumnKeys` — o link só pode esconder **mais** colunas do que a view já esconde.
- Itens: só de topo (sem subitens), até **1.000**, ordenados por `(group_id, position)`, sem paginação. `allowSearch` filtra por nome (`?q=`) quando habilitado.
- **Filtros, ordenação e agrupamento da própria view não são aplicados na leitura pública** nesta entrega — fica para quando uma tela pública de Tabela/Kanban precisar deles de verdade. A API devolve o board (grupos e colunas) e os itens; montar a mesma visualização da view é trabalho futuro do front-end público.
- Sem tela pública no `apps/web` ainda (só a API) — entra quando o link for exposto na UI de gerenciamento de views.

## 11. Filtros salvos

`saved_filters` (pessoal ou compartilhado) reutiliza a mesma AST de `filters`. `GET/POST /v1/boards/:boardId/saved-filters` (pessoal exige `board.read`, compartilhado exige `view.manage`); `DELETE /v1/saved-filters/:id` exige ser o dono ou `view.manage`. Não aparecem como view — são atalhos de filtro reutilizáveis entre views do mesmo board (ex.: o mesmo filtro "Sem replanejamento" usado na Tabela e no Kanban).

## 12. Permissões

Tabela completa em `docs/permissions.md` ("Views, link público e filtros salvos").
