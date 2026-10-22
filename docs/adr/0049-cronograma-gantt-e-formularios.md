# ADR 0049 — Cronograma (Calendário/Timeline/Gantt), caminho crítico, baselines e Formulários

- **Status:** Aceita
- **Data:** 2026-10-22
- **Prompt:** 8

## Contexto

O Prompt 8 soma, ao board genérico já existente, um nível de planejamento (datas nativas do item,
EAP/WBS, dependências FS/SS/FF/SF com lag, caminho crítico, baselines) e um canal de captação
externo (Formulários, público ou interno). Nenhuma das duas coisas existia antes; ambas precisam
caber no modelo multi-tenant/RLS e no contrato de permissões já estabelecidos, sem introduzir um
segundo motor de regras paralelo ao que a Tabela/Kanban já usam (filtros, `requiredWhen`, colunas).

## Decisões

### Campos nativos de agendamento (não uma coluna)

- `plannedStartDate`/`plannedEndDate`, `replannedStartDate`/`replannedEndDate`,
  `actualStartDate`/`actualEndDate`, `progress`, `isMilestone`, `scheduleMode`
  (`'auto' | 'manual'`) são **colunas da tabela `items`**, não uma coluna customizável do board —
  todo item de qualquer board as tem, do mesmo jeito que `name`/`position`. Uma coluna `date` do
  board pode ser **vinculada** (`binding`) a uma delas para aparecer na Tabela; sem vínculo, elas só
  aparecem nas views de planejamento. `NATIVE_FIELD_BINDINGS` (`work/domain/item.ts`) mapeia campo
  nativo → chave de binding, reaproveitado pelas permissões por coluna (`hiddenColumns`) para também
  esconder o campo nativo correspondente quando a coluna vinculada estiver oculta.
- `scheduleMode: 'manual'` tira o item do recálculo automático do worker ao mover um predecessor —
  o usuário assume o controle da data, mesmo com dependências declaradas (paridade com MS Project).

### EAP/WBS: derivada, nunca gravada

- A numeração (`1`, `1.1`, `1.2`, `2`...) é calculada em `packages/shared/src/wbs.ts`
  (`computeWbsNumbers`, função pura) a partir de grupo → hierarquia item/subitem → `position`
  (fractional index), toda vez que o Gantt é lido. Nenhuma coluna/tabela guarda o código WBS: mover
  um item, reordenar um grupo ou criar um subitem muda a numeração automaticamente, sem migração de
  dados nem risco de ficar desatualizada.

### Caminho crítico (CPM) e calendário de dias úteis

- `packages/shared/src/scheduling.ts` implementa CPM clássico (early/late start/finish, folga total,
  `isCritical = folga === 0`) sobre `ScheduleTask`/`ScheduleLink`, usando o calendário de dias úteis
  do board (`loadWorkingCalendar`, já existente desde o Prompt 2) para converter lag em dias corridos
  respeitando feriados/fins de semana.
- `GET /v1/boards/:id/gantt` (`planning/application/gantt.service.ts`) é o **único endpoint** que o
  Gantt lê: tarefas (com WBS e datas "vigentes" — replanejado se houver, senão planejado),
  dependências e o caminho crítico já calculados no servidor. O cliente nunca recalcula CPM/WBS — só
  renderiza o que a API devolve e refaz a consulta quando um evento `item.updated` chega (qualquer
  mudança de data, dependência ou grupo pode mudar o caminho crítico inteiro).
- O worker (`apps/worker/src/processors/schedule.ts`) escuta `item.updated`/`item.dependencies_changed`
  no outbox e, para cada sucessor em modo `'auto'`, reagenda a data conforme o tipo/lag da
  dependência e o calendário de dias úteis — e registra auditoria (`item.rescheduled`) a cada
  reagendamento em cascata.

### Baselines: fotografia, não um segundo cronograma

- Capturar uma baseline copia `plannedStartDate`/`plannedEndDate`/`progress` de todos os itens do
  board, no momento da captura, para `baseline_items` (ADR própria de schema, sem RLS adicional além
  da herdada por `tenant_id`). Comparar não recalcula nada: é uma junção simples entre a baseline e
  os campos atuais do item (`BaselineComparisonRow`), com a baseline primária marcada por board
  (`is_primary`, uma só por vez — trocar desmarca a anterior na mesma transação).

### Importação MS Project: XML (MSPDI), `.mpp` fora de escopo

- Só o formato `.xml` (MS Project Data Interchange) é aceito; `.mpp` binário exige uma biblioteca de
  terceiros sem equivalente Node confiável e está fora do escopo deste prompt (`422
  unsupported_format` com mensagem explícita, não um placeholder silencioso).
- `parseMspXml` usa `fast-xml-parser` e normaliza a diferença de o parser devolver objeto único vs.
  array quando há 1 vs. >1 `<Task>`/`<PredecessorLink>`. A tarefa `UID=0` (resumo implícito do
  projeto, que o MS Project sempre inclui) é descartada. Hierarquia por `OutlineLevel` **não** é
  reconstruída — toda importação cria itens de topo no grupo escolhido (limitação documentada, não
  um bug: reconstruir subitens exigiria resolver `OutlineNumber`→`parentItemId` antes de qualquer
  item existir, o que o fluxo de duas fases preview→commit não cobre ainda).
- Preview (`POST .../schedule-imports`) e commit (`POST .../schedule-imports/:id/commit`) são
  operações separadas — o preview nunca grava nada, só valida e mostra uma amostra; só o commit cria
  itens/dependências, num grupo escolhido pelo usuário na hora.

### Formulários: três caminhos de autorização, uma única fonte de verdade de campos

- Um campo de formulário (`form_fields`) mapeia para uma coluna real do board (`columnKey`), para um
  dos dois campos nativos reservados (`'name'`/`'description'`), ou para nenhum (`columnKey: null`,
  resposta livre que só fica no envio bruto, nunca vira valor de item). Quando mapeado a uma coluna
  real, o `fieldType` enviado pelo cliente é **ignorado** — o servidor sempre usa o tipo real da
  coluna (`resolveFieldType`); só campos nativos/reservados escolhem o tipo (`text`, `long_text`,
  `email`, `phone`, `number`, `date`, `checkbox`).
- Coluna **vinculada** (`binding !== null`, ex.: uma coluna `date` ligada a `plannedEndDate`) é
  rejeitada ao virar campo de formulário (`422 column_bound`): ela só se grava pelo campo nativo do
  item, não por `values`, e o formulário ainda não sabe emitir essa escrita — fora de escopo aqui.
- "Mostrar quando" (`showWhen`) reaproveita **a mesma AST de filtro** que a obrigatoriedade
  condicional de coluna já usa (`FilterGroup`/`matchesFilter`, ADR 0039) — não existe um segundo
  motor de regras para formulários. `packages/shared/src/forms.ts` expõe
  `partialItemStateFromAnswers`/`mapFormAnswers`, usados tanto pela validação no servidor quanto pela
  visibilidade ao vivo no preenchimento (público e interno).
- Três caminhos de envio, todos reaproveitando a mesma `FormSubmissionService`:
  1. **Público anônimo** (`isPublic`, sem `requiresLogin`): token de link + honeypot vazio + captcha
     (desafio de soma auto-emitido e assinado por HMAC, sem serviço de terceiros — `CaptchaService`).
     Como não há usuário real, o contexto de escrita usa um `WriteContext` montado manualmente com um
     UUID sentinela, para não acionar `AccessService.principal()` (que lança para usuário inexistente)
     nem a checagem de permissões por coluna normal do item.
  2. **Público com login** (`isPublic` + `requiresLogin`): mesmo token de link, mas exige um Bearer
     real (`OptionalPrincipal`, novo decorator que devolve `null` em vez de lançar quando ausente — a
     mesma rota pública aceita token opcional). Sem captcha/honeypot; checa explicitamente
     `principal.tenantId === resolved.tenantId` para um token de outro tenant não ser aceito.
  3. **Interno autenticado** (`POST /v1/forms/:id/submit`): sem token de link, permissão `item.create`
     normal no board — o mesmo caminho de permissões por coluna da Tabela/Kanban.
- A rota de envio público roda `@Audited({transactional: false})`: sem principal, o
  `TransactionInterceptor` não abre transação (só abre quando há usuário autenticado) — o serviço
  abre a sua própria via `TransactionRunner.run`, mesmo padrão já usado pelo link público de view
  (ADR 0047) e pelo webhook de e-mail (ADR 0048).

### Frontend: um endpoint por view, sem recálculo no cliente

- Calendário/Timeline escrevem datas via `PATCH /v1/items/:id` (`fields` para campo nativo, `values`
  para coluna `date`) com atualização otimista de cache — o mesmo utilitário (`patchItem`) que
  Tabela/Kanban já usam para aplicar eventos de tempo real, não um caminho de escrita novo.
- O Gantt usa um hook de escrita dedicado (`usePatchGanttItem`) em vez de estender `useItemWriter`
  (usado por Tabela/Kanban): arrastar uma barra ou alternar marco/modo manual não deve acionar o
  fluxo de "campo obrigatório"/desfazer da Tabela, que não faz sentido aqui.
- Arrastar uma barra do Gantt move o intervalo inteiro (mantém a duração); **não há redimensionar as
  pontas** nesta entrega — ajustar só o início ou só o fim exige abrir o item e usar outro caminho
  (ex.: reimportar, ou um redimensionamento dedicado, fora de escopo aqui). Uma tarefa com só
  `plannedStartDate` (sem término ainda) aparece como uma barra de um dia, em vez de ficar invisível
  — mesma convenção que a Timeline já usa para o mesmo caso.
- O construtor de formulário reaproveita o `FilterBuilder` da Tabela para "mostrar quando" e o
  `ValueField`/`ValueEditor` da Tabela para o preenchimento **interno** (fidelidade total de tipo,
  incluindo pessoas/tags/arquivos). O preenchimento **público** usa um conjunto menor e seguro de
  widgets (os 7 tipos nativos + `status`/`dropdown` de escolha única) — tipos de coluna mais
  complexos mapeados a um campo público mostram um aviso em vez de um widget genérico que poderia
  gravar um valor malformado.

## Consequências

- Nenhuma tabela nova guarda WBS ou caminho crítico — menos uma fonte de verdade para manter
  sincronizada, à custa de recalcular CPM a cada leitura do Gantt (aceitável: o board inteiro cabe
  numa consulta, não há paginação de milhares de tarefas neste prompt).
- A ausência de redimensionamento de barra no Gantt e de criação direta de item nele (só Calendário e
  Timeline criam) é uma lacuna de usabilidade conhecida: hoje um item nasce sem `plannedEndDate` até
  alguém arrastar/editar uma data; fica para um prompt futuro dar ao Gantt seu próprio fluxo de
  criação com intervalo completo.
- `.mpp` continua sem suporte — qualquer board que dependa de arquivos binários do MS Project precisa
  exportar para `.xml` primeiro (o próprio MS Project faz isso nativamente).
