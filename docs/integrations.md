# Integrações e API pública

Visão geral da API pública (tokens/apps OAuth), dos webhooks e das integrações de terceiros do
Prompt 15 (ADR 0056). Toda credencial de terceiro é **BYOK** (bring your own key) — a organização
cadastra seu próprio app/token/webhook; a plataforma nunca compartilha uma credencial própria.

## 1. API pública

### Tokens pessoais

Autosserviço, sem permissão especial (o mesmo espírito de trocar a própria senha):

- `POST /v1/me/tokens` — `{ name, scopes, expiresAt? }` → devolve o token em texto puro **uma única
  vez** (`token`); a partir daí só `tokenPrefix` (ex.: `ctk_a1b2c3d4`) identifica o token na lista.
- `GET /v1/me/tokens`, `DELETE /v1/me/tokens/:id` — listar/revogar os próprios tokens. Um token não
  pode ser usado para criar outro (a autenticação de `/v1/me/tokens` exige sessão, não `ctk_...`).

Escopos (`packages/shared/src/api-access.ts`): `boards:read`/`boards:write`, `items:read`/
`items:write`, `automations:manage`, `webhooks:manage`, `templates:manage`, `files:read`/
`files:write`. Um escopo de escrita sempre implica a leitura correspondente. O escopo é um **teto**
aplicado antes do RBAC normal (`AccessService.can`, `api-scope-map.ts`) — nunca o substitui: um
token só pode o que (a) seu escopo cobre E (b) o dono do token poderia fazer de qualquer forma.
Ações fora do catálogo de escopos (gestão de membros, papéis, IA, contratos, timesheet, portfólio…)
são **sempre bloqueadas** para um principal autenticado por token, mesmo que o dono pudesse fazê-las
numa sessão normal.

Requisições autenticadas por token são limitadas a 300 req/min (`RateLimitGuard`, variante `token`,
somada — nunca substituindo — ao limite normal da rota) e gravam `actorKind: 'api'` na auditoria
(`TransactionInterceptor`), distinguindo-as de uma ação feita por sessão de usuário comum.

### Administração de tokens e apps OAuth (`api_tokens.manage`, tenant)

- `GET /v1/tokens`, `DELETE /v1/tokens/:id` — lista/revoga o token de **qualquer** usuário do tenant.
- `GET/POST /v1/oauth-apps`, `PATCH/DELETE /v1/oauth-apps/:id` — apps OAuth do tenant (para
  integrações de terceiros consumirem a API pública via `client_credentials`). O `clientSecret` é
  mostrado uma única vez na criação.
- `POST /v1/oauth/token` (público) — `{ grant_type: 'client_credentials', client_id, client_secret }`
  → `{ access_token, token_type: 'Bearer', expires_in }` (1 hora). O token emitido tem exatamente os
  `scopes` do app, nunca mais — um app não herda papel algum no RBAC; o token resultante age com as
  permissões de quem **criou** o app (mesmo raciocínio usado para o "agir como" de webhooks de
  integração, §3).

### Documentação da API

`GET /v1/docs` (Swagger UI) e `GET /v1/openapi.json` (`docs/openapi.json` gerado por
`pnpm --filter @cube-track/api openapi:export`) documentam todas as rotas, incluindo o formato do
token (`ctk_...`) como esquema de segurança.

## 2. Webhooks de saída (ADR 0051, estendido no Prompt 15)

O motor (HMAC-SHA256, retentativa exponencial, desativação após 10 falhas seguidas) já existia desde
o Prompt 10. Esta entrega completa a parte de observabilidade:

- `GET /v1/webhooks/:id/deliveries` (`webhook.manage` do board) — log de entregas, mais recente
  primeiro (status, tentativa, código de resposta, duração, erro).
- `POST /v1/webhook-deliveries/:id/resend` — reenfileira o MESMO evento para o MESMO webhook com um
  `eventId` novo; nunca sobrescreve a linha de entrega original (trilha completa preservada, mesmo
  princípio de "nunca apagar auditoria" usado na reversão de ações de agente de IA).

## 3. Templates

- **Galeria pública** (`GET /v1/templates?scope=public`): templates globais (`tenant_id` nulo),
  somente leitura para qualquer tenant — 4 embutidos desde o início (Board em branco, Projeto,
  Solicitações, Ordens de serviço) + 7 novos nesta entrega: Implantação – Template Base, Sustentação,
  Scrum, Kanban de serviços, PMO (`kind: workspace`, bundla portfólio de projetos + riscos/problemas —
  um template de `kind: dashboard` global é inviável porque todo `WidgetConfig` referencia
  `boardId`s reais, impossíveis de pré-semear sem um tenant concreto), Onboarding, Gestão de
  contratos UST.
- **Galeria interna** (`GET /v1/templates`, `templates.manage` para criar/editar/excluir): templates
  do próprio tenant.
- `POST /v1/templates/:id/apply` — cria board/workspace/automação/dashboard/formulário a partir do
  template, reaproveitando os mesmos caminhos de criação de cada módulo (nunca um segundo motor de
  criação de board).
- `POST /v1/boards/:boardId/save-as-template` (`board.manage`) — tira um **snapshot** do board atual
  (grupos, colunas e, opcionalmente, itens) para um novo template do tenant; mudanças futuras no board
  não afetam o template salvo. Só colunas de valor portável (texto, número, data, status, dropdown,
  checkbox, avaliação, e-mail, telefone) entram no snapshot de itens — pessoas, arquivos, relações e
  fórmulas ficam de fora (não há como remapear esses ids entre boards).

## 4. Importação em background

Complementa o importador síncrono de CSV/Excel do Prompt 5 (que continua existindo, para uploads
pequenos e imediatos) com um pipeline que processa no **worker**, com registro persistente de
progresso/erro — necessário para os novos formatos de origem:

- `POST /v1/boards/:boardId/imports/preview` — `{ source: 'csv'|'monday'|'trello'|'jira'|'pipefy',
  fileName, contentBase64 }`. Monday/Jira/Pipefy exportam CSV tabular (reaproveita o mesmo
  `parseCsv`); Trello exporta um JSON de board inteiro, convertido para a mesma forma tabular por
  `trelloExportToTable` antes de entrar no mesmo pipeline. Sugestão de mapeamento com heurísticas por
  origem (`suggestImportMapping`).
- `PATCH /v1/imports/:importJobId/mapping` — ajusta o mapeamento antes de confirmar.
- `POST /v1/imports/:importJobId/commit` — enfileira o job (fila `imports`); `GET
  /v1/imports/:importJobId` consulta status/resultado (`createdCount`/`skippedCount`/`errorReport`).
- O worker aplica cada linha com `parseCellText` (o mesmo motor determinístico de conversão
  texto→valor usado em toda a plataforma) e nunca falha o job inteiro por causa de linhas ruins —
  essas entram no relatório de erro como "puladas".

**Critério de aceite verificado**: importar um board exportado do Monday (ou um export JSON do
Trello) preserva grupos (listas/grupo), itens e responsáveis — testado de ponta a ponta em
`apps/worker/test/imports.e2e.test.ts`.

## 5. Integrações de terceiros (ADR 0056)

### Conexões (`integrations.manage`, workspace)

`GET /v1/workspaces/:workspaceId/integrations`, `DELETE /v1/integrations/:connectionId` — comum a
todos os provedores. Uma conexão é `authKind: 'oauth'` (Google/Microsoft, por usuário) ou
`authKind: 'webhook_secret'` (Slack/Teams/GitHub/GitLab/Azure DevOps, por workspace inteiro).

### Google Workspace / Microsoft 365

O tenant cadastra seu **próprio app OAuth** (Google Cloud Console / Azure AD) — `POST
/v1/workspaces/:id/integrations/{google,microsoft}/connect` guarda `clientId`/`clientSecret` cifrados
numa tabela dedicada (`integration_apps`, por workspace+provedor, já que o app pertence ao workspace
inteiro, não a quem conectou primeiro). Cada usuário então consente individualmente (fluxo OAuth
padrão, estado opaco guardado no Redis com TTL curto — mesmo padrão do callback de login já
existente); os tokens de acesso/atualização ficam cifrados em `integration_connections`.

- **Calendário, nas duas direções**: item → evento (ao criar/atualizar `plannedStartDate`/
  `plannedEndDate`, processado assincronamente pela fila `calendar-sync`) e evento → item (rotina
  periódica `calendar-sync-periodic`, a cada 15 min, reconcilia mudanças feitas direto no Google
  Agenda/Outlook — sempre escrevendo no item através do service real, nunca um `UPDATE` cru).
- **Drive/OneDrive**: `POST/GET /v1/items/:itemId/external-files` vincula um arquivo **por
  referência** (nome/ícone/link, nunca baixado/reenviado ao nosso storage) — tabela própria
  (`external_file_links`), separada dos anexos de verdade.
- **E-mail → item**: desenhado para reaproveitar o `MailInboundService` já existente (Prompt 9,
  mesmo endpoint `POST /v1/email/inbound` que processa e-mails encaminhados manualmente) via um job
  de polling que chama esse mesmo endpoint HTTP a partir do worker — **a parte de polling em si não
  foi implementada nesta entrega** (lacuna documentada abaixo).

### Slack / Microsoft Teams

`POST /v1/workspaces/:id/integrations/{slack,teams}/connect` — Slack recebe `incomingWebhookUrl` +
`signingSecret`; Teams só `incomingWebhookUrl` (sem comando/interação — exigiria um app registrado no
Bot Framework, fora de escopo).

- **Notificação de saída**: quando a preferência de notificação do usuário é `slack`/`teams`, o
  worker posta no Incoming Webhook do canal (sem fila/retentativa própria — simples e documentado
  como aceitável, diferente do motor de webhooks do tenant em §2).
- **Comando de barra** (`/cubetrack create <item>`): cria um item no board padrão configurado na
  conexão. Como não há sessão de usuário, a ação "age como" quem **conectou** a integração
  (`integration_connections.createdBy`), com as permissões normais dessa pessoa como teto — mesmo
  raciocínio do app OAuth `client_credentials` (§1).
- **Link preview**: o payload de unfurl é montado (nome/status do item), mas a chamada de volta
  `chat.unfurl` do Slack não foi implementada — o BYOK desta entrega é só Incoming Webhook + signing
  secret, sem um bot token com permissão de unfurl.

### GitHub / GitLab / Azure DevOps

`POST /v1/workspaces/:id/integrations/{github,gitlab,azure-devops}/connect` guarda o segredo de
verificação do webhook de ENTRADA (nunca chamamos de volta a API do provedor). Cada provedor assina
suas requisições de um jeito diferente:

| Provedor      | Verificação                                                          |
| ------------- | ---------------------------------------------------------------------- |
| GitHub        | HMAC-SHA256 do corpo bruto, header `X-Hub-Signature-256`               |
| GitLab        | Token simples no header `X-Gitlab-Token` (comparação direta)           |
| Azure DevOps  | HTTP Basic Auth (usuário/senha configurados no service hook)           |

`POST /v1/integrations/{provider}/:connectionId/webhook` (público, por conexão): normaliza o evento,
extrai referências de item (`#<valor de uma coluna auto_id>` ou UUID) da mensagem de commit/título de
PR, registra um vínculo (`dev_event_links`, sempre, mesmo sem avanço de status) e, quando o evento é
um PR mesclado, tenta avançar o status do item com uma heurística **deliberadamente conservadora**
(`pickStatusAdvance`): só avança quando a coluna de status tem pelo menos 3 categorias representadas
(ignora colunas binárias tipo "Sim/Não" que também têm rótulo de categoria `done`) e exatamente um
rótulo candidato a "concluído" — qualquer ambiguidade não avança nada, preferindo não agir a adivinhar
errado e corromper um status não relacionado.

## 6. Lacunas conhecidas (documentadas, não escondidas)

- Polling de e-mail→item (Gmail/Outlook) não implementado — o ponto de reuso (`MailInboundService`/
  `POST /v1/email/inbound`) está identificado e documentado, mas a plumbing de buscar mensagens novas
  fica para uma entrega futura.
- Reconciliação de exclusão de evento pelo lado do Microsoft Graph é só best-effort (a listagem
  simples usada hoje não distingue "evento não mudou" de "evento foi excluído"; uma consulta delta
  resolveria isso com mais precisão).
- Slack: sem link-unfurl de verdade (só o payload, sem bot token); Teams: sem comando/interação.
- Notificação por chat (Slack/Teams) é um POST direto, sem fila/retentativa — aceitável para
  notificação best-effort, diferente do motor de webhooks do tenant.
- Sem frontend ainda para nenhuma destas telas nesta entrega de backend (acompanhar
  `docs/roadmap.md`).
- Conector Power BI e export para Google Sheets: a API pública + export CSV/Excel existentes
  (`GET /v1/boards/:id/export`) já servem como base de dados para o Power BI (conector genérico via
  OData/REST) e para Google Sheets (importação de CSV) — não há um conector dedicado nesta entrega,
  por ora apoiado na API/export genéricos já existentes.
