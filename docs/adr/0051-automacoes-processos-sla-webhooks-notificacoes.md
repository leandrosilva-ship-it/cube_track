# ADR 0051 — Automações, Processos/SLA, Webhooks e preferências de notificação

- **Status:** Aceita
- **Data:** 2026-10-26
- **Prompt:** 10

## Contexto

O Prompt 10 fecha o ciclo operacional→estratégico com automação de trabalho: regras "quando X,
então Y" por board, processos (Pipefy-like: fases, formulário por fase, SLA por fase) sobre o
Kanban já existente, webhooks de saída para integrar com sistemas externos, e controle por pessoa
de quando e como é notificada. As tabelas de automações (`automations`), processo
(`pipes`/`phases`/`phase_transition_rules`/`slas`/`sla_trackers`/`sla_events`) e
`notification_preferences` já existiam desde prompts anteriores (schema antecipado); este prompt
entrega os motores (shared + worker), a API e o frontend sobre elas, mais o módulo novo de
`webhooks`/`webhook_deliveries` (schema e tudo).

## Decisões

### Motor de automações em `packages/shared`, não no worker

- O motor (resolução de gatilho, condições `AND`-only nesta versão, ações) mora em
  `packages/shared/src/automations.ts`, não em `apps/worker` — API e worker precisam da mesma
  lógica de validação de `trigger`/`actions`/`conditions` (a API valida ao salvar; o worker
  executa), e duplicá-la seria a mesma classe de risco que motivou mover o formula engine para
  shared (ADR anterior). Gatilhos: `item_created`, `column_value_changed`, `button_clicked`,
  `date_arrives`. Ações: `move_to_group`, `set_column_value`, `notify`.
- `date_arrives` é verificado uma vez ao dia (`automations-date-check`, worker) via
  `app.date_arrives_candidates()` — uma função `SECURITY DEFINER` (o papel do banco da aplicação
  não tem bypass de RLS) que devolve só as tuplas mínimas de id para a varredura entre tenants,
  nunca dados de negócio. O mesmo padrão se repete para a verificação periódica de SLA
  (`app.sla_tracker_alerts()`) e para o digest de notificações
  (`app.notification_digest_candidates()`, abaixo).
- **Botão clicável exige vínculo explícito `column.settings.automationId`**: a API
  (`clickButton()`) só dispara a automação se a coluna de botão apontar para ela E o gatilho da
  automação bater (`type: 'button_clicked'` e o mesmo `columnKey`) — existe para impedir que uma
  automação de outro board/contexto seja disparada por engano. **Bug encontrado e corrigido durante
  a escrita dos testes E2E deste prompt**: o construtor de automações no frontend nunca gravava
  esse vínculo (`settings.automationId`) ao criar/editar/excluir uma automação `button_clicked` — o
  botão ficava sempre "sem automação configurada" (desabilitado), mesmo com tudo certo no
  servidor. Corrigido em `automations-dialog.tsx`: ao salvar, a coluna de botão referenciada ganha
  `settings.automationId`; ao trocar de coluna ou excluir a automação, o vínculo antigo é
  desfeito.

### Processos: regras de transição são opt-in; SLA só por fase

- Mover um item de fase só é bloqueado se existir uma `phase_transition_rules` específica para o
  par (fase de origem → fase de destino) ou um coringa (`fromPhaseId: null`) para a fase de
  destino; sem regra, o movimento é livre — governança é algo que se liga por fase/transição, não
  um padrão restritivo por default. Uma regra pode exigir campos preenchidos
  (`requiredColumnKeys`), papel (`allowedRoleIds`, com `board.manage` sempre podendo sobrepor),
  condições (`evaluateConditions`, reaproveitado do motor de automações) e aprovação
  (`requiresApproval` exige um `approval_requests` já aprovado e posterior à entrada na fase atual
  — reaproveita o módulo de aprovações do Prompt 3 tal como está, sem criar/disparar pedidos
  automaticamente).
- `phases.requiredColumnKeys` (campo próprio da fase, distinto da regra de transição) é só metadado
  de CRUD nesta entrega — não é aplicado em nenhuma gravação; é o contrato para quando o builder de
  formulário por fase (`phases.formId`) ganhar uma tela própria num prompt futuro.
- SLA é escopado a **uma fase** (`slas.phaseId`), não a um pipe/board inteiro com múltiplas fases —
  cobre o caso central (cada fase tem seu prazo) sem a complexidade de um SLA que soma tempo
  através de várias fases.
- Tempo útil (`useBusinessTime`) assume **offset UTC fixo por fuso** (`packages/shared/src/
business-time.ts`) em vez de um banco de fusos IANA completo — correto para o Brasil (sem horário
  de verão desde 2019) e documentado como incorreto para fusos que ainda observam DST; migrar para
  uma lib de fusos completa fica para quando houver um tenant fora do Brasil que precise disso.

### Webhooks: fan-out e entrega em filas separadas; mesmo segredo simétrico das chaves TOTP

- Duas filas (`webhooks` → `webhook-deliveries`) em vez de uma: um job por evento durável resolve
  os webhooks correspondentes e despacha **uma entrega independente por webhook** (`jobId`
  determinístico `${eventId}.${webhookId}`). Sem essa separação, a retentativa automática do BullMQ
  de uma entrega que falhou reexecutaria o mesmo job para TODOS os webhooks daquele evento,
  reenviando a quem já recebeu com sucesso.
- Entrega assina o corpo com HMAC-SHA256 do segredo (`X-CubeTrack-Signature`), gravando cada
  tentativa em `webhook_deliveries` (idempotente por `webhookId`+`eventId`). Na última tentativa
  sem sucesso, soma `consecutiveFailures`; ao atingir 10, desabilita o webhook automaticamente
  (`isEnabled: false`, `disabledAt`) — evita bater numa URL morta indefinidamente.
- **Escopo**: só eventos de **board** (`boardId` não nulo) disparam webhooks nesta entrega; eventos
  de workspace/tenant sem board (ex.: `workspace.structure_changed`) não alcançam webhooks
  configurados no nível do workspace, porque o formato do job de evento do outbox não carrega
  `workspaceId` para resolver esse casamento sem um board como âncora. Webhooks com `boardId: null`
  (workspace inteiro) continuam casando com qualquer evento de board daquele workspace.
- O par `encryptSecret`/`decryptSecret` (AES-256-GCM) que já existia só em `identity/domain/
secrets.ts` (para o segredo TOTP) subiu para `packages/shared/src/crypto.ts`: o worker precisa
  decifrar o que a API cifra, e cópia-colada de criptografia entre dois apps é o tipo de duplicação
  que gera divergência silenciosa. A API agora reexporta de `shared` em vez de ter sua própria
  cópia.
- Nova permissão `webhook.manage` (board) — nenhuma das existentes (`automation.manage`,
  `process.manage`) fazia sentido reaproveitar para um recurso tão sensível (o segredo HMAC).
  Concedida a `board_owner` no provisionamento de tenant (único lugar, usado tanto por tenants
  novos quanto pelo seed de demonstração).

### Preferências de notificação: resolução específico→curinga→padrão; sem digest semanal

- `GET/PUT /v1/me/notification-preferences` segue o mesmo padrão de recurso pessoal de `/v1/me/
favorites` (mesmo módulo `structure`, sem um módulo novo). A API devolve só as linhas que a
  pessoa já personalizou (nunca grava linhas sintéticas de "padrão") — a mesma regra de resolução
  do worker (`eventType` específico → `'*'` curinga → padrão instantâneo) decide o efetivo quando
  não há linha.
- **Bug encontrado e corrigido nesta entrega**: `notifyApproval` (worker) enviava e-mail instantâneo
  de aprovação sem nenhuma checagem de preferência — diferente de `notifyMentions`, que já respeitava
  `channel: 'email'`. Corrigido para resolver a preferência do mesmo jeito antes de enviar.
- `'weekly'` existe no enum do banco (`notification_frequency`) mas a API de preferências não aceita
  esse valor: nenhuma rotina de digest o esvazia — aceitar e nunca entregar deixaria notificações
  paradas para sempre. Só `instant`/`hourly`/`daily`/`never` são graváveis; os dois novos jobs de
  manutenção (`notification-digest-hourly` a cada hora, `notification-digest-daily` às 8h) cobrem
  os dois únicos valores de digest suportados.
- Nova coluna `notifications.email_sent_at` marca o que já foi entregue (instantâneo ou por
  digest), e é a chave da consulta `WHERE email_sent_at IS NULL` que faz o digest nunca reenviar o
  que o caminho instantâneo já mandou.
- **Sem evento de tempo real** para mudança de preferência — é uma configuração pessoal, sem
  precedente de evento (as preferências de MFA em `identity` também não têm um); criar um evento
  cujo único efeito seria revalidar a mesma aba que acabou de gravar não paga o custo de mais um
  tipo em `EVENT_PAYLOADS`.
- No frontend, as preferências entraram como uma seção a mais da tela de Configurações existente
  (ao lado de perfil/segurança/MFA) em vez de uma página nova — é exatamente o mesmo tipo de
  conteúdo (uma preferência pessoal), e dividir em duas telas forçaria a pessoa a navegar para achar
  algo que já está no lugar certo.

### Frontend: três diálogos no cabeçalho do board, no mesmo molde

- "Automatizar", "Processo" (só em boards `kind: 'process'`) e "Integrar" (webhooks) seguem
  exatamente o padrão já usado por Compartilhar/Convidar: um botão no cabeçalho vira
  `DialogTrigger`, cada diálogo é lista↔formulário com o mesmo `Modal`/`Field`/`Select` do design
  system, gate de permissão decide entre o botão real e o `ModuleButton` (desabilitado,
  `aria-disabled`, nunca some) já usado para os módulos ainda não habilitados.
- Indicadores de fase (selo "Início"/"Intermediária"/"Concluída"/"Cancelada" + contagem de WIP) e de
  SLA (badge "Vence em"/"Vencido há", cor por urgência) entram no Kanban já existente
  (`kanban-column.tsx`/`kanban-card.tsx`) em vez de uma tela de processo separada — um board de
  processo é, antes de tudo, um Kanban; a config de pipe/fase/SLA é only a tela de configuração, não
  uma visualização paralela dos itens.

## Consequências

- Nenhuma tabela nova para automações/processos/preferências (schema já existia desde prompts
  anteriores); `webhooks`/`webhook_deliveries` são as únicas tabelas genuinamente novas deste
  prompt, mais a coluna `notifications.email_sent_at` e a função `app.notification_digest_candidates`.
- Dois bugs pré-existentes (botão sem vínculo de automação; aprovação ignorando preferência de
  e-mail) foram encontrados e corrigidos ainda durante a escrita dos testes deste prompt, antes de
  qualquer uso manual — nenhum dos dois exigiu migração, só lógica de aplicação.
- Lacunas conhecidas para um prompt futuro: webhooks de workspace não alcançam eventos sem board;
  tempo útil de SLA não cobre fusos com horário de verão; `phases.requiredColumnKeys` é metadado
  sem aplicação até existir formulário por fase; preferência `weekly` sem rotina correspondente
  (guardada no enum do banco por compatibilidade futura, recusada pela API).
