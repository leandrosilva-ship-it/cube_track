# ADR 0056 — API pública, Integrações, Importadores e Templates

- **Status:** Aceita
- **Data:** 2026-11-05
- **Prompt:** 15

## Contexto

O Prompt 15 entrega, em três partes, tudo que conecta o CUBE TRACK ao resto do ecossistema de quem o
usa: (1) API pública com tokens pessoais e apps OAuth `client_credentials`, (2) webhooks de saída
(log/reenvio), galeria de templates e importação em background (Monday/Trello/Jira/Pipefy/CSV), (3)
— **esta entrega** — integrações de terceiros: Google Workspace/Microsoft 365 (OAuth, calendário,
Drive/OneDrive por referência, e-mail-para-item), Slack/Microsoft Teams (notificação de saída, comando
de barra, link preview) e GitHub/GitLab/Azure DevOps (webhook de entrada → vínculo de item e
auto-avanço de status). As partes 1-2 já estão documentadas no código sob esta mesma referência de ADR
(commits `2cf36a7`, `c370e24`); este documento formaliza a ADR que faltava registrar e cobre em detalhe
as decisões da parte 3.

Tabelas novas desta parte: `integration_apps`, `integration_connections`, `calendar_sync_links`,
`external_file_links`, `dev_event_links` (`packages/db/src/schema/integrations.ts`), todas `tenant_id`

- RLS (migrações `0028`, `0030`-`0032`). Contrato compartilhado em `packages/shared/src/integrations.ts`.

## Decisões

### Toda credencial é BYOK — sem exceção, nem para o app OAuth do Google/Microsoft

- Nenhum provedor usa uma credencial compartilhada da plataforma. GitHub/GitLab/Azure DevOps: a
  organização cola o segredo do PRÓPRIO webhook (`integration_connections.webhookSecretCiphertext`).
  Slack: a própria Incoming Webhook URL + signing secret do PRÓPRIO app Slack. Teams: a própria
  Incoming Webhook URL (sem signing secret — ver limitação abaixo). Google/Microsoft: o PRÓPRIO app
  OAuth (client id/secret do Google Cloud Console/Azure AD).
- **Onde fica o app OAuth do tenant**: tabela nova `integration_apps`, chaveada por
  `(tenantId, workspaceId, provider)` — DECISÃO DE DESIGN explícita (não óbvia a partir do schema
  entregue): o app é cadastrado **uma vez** por um admin do workspace e reaproveitado por toda conexão
  pessoal seguinte do mesmo provedor nesse workspace. Não cabia dentro de
  `integration_connections.metadata` porque `metadata` é por LINHA (por usuário, no caso de OAuth) e o
  app é um dado de workspace inteiro — colocá-lo ali faria o app "pertencer" à primeira pessoa a
  conectar e desaparecer se ela desconectasse.

### Callback OAuth: estado opaco no Redis, nunca o cookie de sessão

- `GET /v1/integrations/:provider/callback` é uma navegação pública do navegador (redirect do
  Google/Microsoft) — mirra exatamente o callback OAuth de LOGIN já existente
  (`IdentityModule`/`AuthService.startOAuth`/`completeOAuth`): o `state` é um token opaco guardado no
  Redis (`integration:oauth:state:<state>`, TTL de 10 min, apagado no primeiro uso) com
  `tenantId`+`userId`+`workspaceId`+`provider`+`emailToItemEnabled` embutidos. Nunca se assume que o
  cookie de sessão sobrevive ao redirect entre domínios — o precedente de login já resolve esse
  problema do mesmo jeito, então a conexão de integração reaproveita a solução, não inventa uma nova.

### Cliente OAuth de conexão é um serviço novo, nunca o `OAuthClient` de login

- `modules/identity/infrastructure/oauth.client.ts` é um único client plataforma inteira (credenciais
  do `.env`), só valida `id_token` de login, nunca persiste `access_token`/`refresh_token` e não tem
  refresh. `HttpOAuthConnectionClient` (`modules/integrations/infrastructure/oauth-connection.client.ts`)
  é BYOK por tenant, pede escopos mais amplos (Calendar com escrita, Drive/Gmail leitura,
  `offline_access` no Microsoft), persiste e ATUALIZA tokens, e expõe `authorizationUrl`/`exchangeCode`/
  `refreshAccessToken`/`fetchFileMetadata` atrás de um token de injeção (`OAUTH_CONNECTION_CLIENT`) —
  mesmo padrão do provedor de IA (ADR 0055): trocar a implementação (ou mockar em teste) é só trocar
  quem está registrado nesse token.

### Push de calendário no worker, não na API — via a MESMA fila de outbox dos demais consumidores

- `item.created`/`item.updated` já disparam para várias filas (`EVENT_CONSUMERS`,
  `packages/shared/src/jobs.ts`); a sincronização de calendário ganhou sua própria fila
  (`calendar-sync`) na mesma lista, em vez de rodar de forma síncrona dentro da requisição HTTP que
  grava o item — uma chamada ao Google/Microsoft nunca deve atrasar ou arriscar a escrita do item.
  `apps/worker/src/processors/calendar-sync.ts` consome essa fila: para cada pessoa atribuída ao item
  (coluna `people`) com uma conexão OAuth Google/Microsoft ativa no workspace do board, cria/atualiza o
  evento de dia inteiro no calendário dela.
- Direção calendário → item é a rotina periódica `calendar-sync-periodic` (nova em
  `MAINTENANCE_JOBS`/`MAINTENANCE_SCHEDULE`, a cada 15 min): lista eventos alterados desde
  `metadata.lastSyncedAt` (abordagem mais simples pedida — sem delta query completa) e reconcilia com
  `calendar_sync_links` pela mesma unidade de trabalho do sistema (`runAsSystem`) que o recálculo de
  cronograma (ADR 0049) já usa — nunca um `UPDATE` SQL cru, sempre com auditoria/outbox/tempo real.
- **RLS exige uma função SECURITY DEFINER para "listar candidatos entre tenants"**: `integration_connections`
  tem RLS normal; a rotina periódica precisa olhar conexões de TODOS os tenants para decidir quais
  processar. Mesmo padrão de `app.contract_alert_candidates()`/`app.sla_tracker_alerts()` (ADR 0054):
  `app.active_oauth_calendar_connections()` (migração `0032`) devolve só `(tenant_id, id)`; a linha
  completa é lida depois, já dentro do contexto do tenant certo.

### "Agir como" num webhook/comando sem sessão: sempre `createdBy`, nunca um ator anônimo

- Conexões `webhook_secret` (Slack/Teams/GitHub/GitLab/Azure DevOps) não têm `userId` — são do
  workspace inteiro. Quando uma ação de escrita precisa de um ator (criar item por comando de barra do
  Slack, auto-avançar status ao mesclar PR), a identidade usada é sempre
  `integration_connections.createdBy` (coluna padrão de toda tabela do tenant — não precisou de um
  campo `connectedBy` à parte) — nunca mais do que essa pessoa poderia fazer pela própria sessão (mesmo
  raciocínio do token de app OAuth `client_credentials`, parte 1 desta ADR). `authKind` fica indefinido
  nesse principal sintético (sessão normal), nunca `'api_token'` — não há escopos de API num comando de
  Slack, só RBAC comum.
- Exceção deliberada: a criação rápida de item por `/cubetrack create <nome>` usa `ItemWriter.insert`
  diretamente com `enforceRequired: false` (em vez do `ItemsService.create` normal) — um comando de
  barra não tem como preencher colunas obrigatórias específicas do board de destino; a criação normal
  pela UI/API continua exigindo os campos obrigatórios sem exceção.

### Auto-avanço de status ao mesclar PR: heurística conservadora com DUAS salvaguardas

- `pickStatusAdvance` (`modules/integrations/domain/status-advance.ts`) só avança quando: (1) a coluna
  de status tem **3 ou mais categorias distintas** representadas entre seus rótulos — exclui colunas que
  são, na prática, um alternador binário (ex.: seed PMSP tem "OS solicitada"/"OS emitida" com rótulos
  Sim/Não, "Sim" de categoria `done`; nenhuma delas é "o" status do item, só a coluna de workflow de
  verdade com ≥ 3 categorias conta); (2) dentro dela, há **exatamente um** rótulo candidato — categoria
  `done` primeiro (sinal estruturado que o board já usa para métricas de portfólio/RAG), e só na
  ausência dela o nome do rótulo batendo com `isDoneLikeStatusLabel` (pt-BR/en/es). Mais de um candidato
  ou nenhum: nunca avança. Item já no rótulo escolhido: nunca avança (nada muda). O `dev_event_links` da
  trilha é gravado **sempre**, mesmo quando o status não avança.
- A escrita em si passa por `ItemsService.update`/`ItemWriter` de verdade (não um UPDATE direto),
  então herda a validação de transição configurada na coluna (`isTransitionAllowed`) e a permissão de
  quem conectou a integração — uma falha ali (ex.: transição bloqueada) é capturada e apenas logada,
  nunca derruba a ingestão do webhook.

### Verificação de assinatura: cada provedor do seu jeito, nunca um esquema genérico

- GitHub: HMAC-SHA256 do corpo BRUTO, `X-Hub-Signature-256`. GitLab: token simples em `X-Gitlab-Token`
  (comparação em tempo constante, sem HMAC). Azure DevOps: HTTP Basic Auth (usuário/senha cadastrados na
  conexão, guardados como um JSON cifrado dentro do único campo `webhookSecretCiphertext` existente no
  schema — não precisou de coluna nova). Slack: `X-Slack-Signature`/`X-Slack-Request-Timestamp`
  (`v0:{timestamp}:{corpo}`, rejeita requisição com mais de 5 min). O corpo BRUTO (antes do parse JSON/
  form-urlencoded) é capturado em `req.rawBody` via `verify` do body-parser (`bootstrap.ts`) — webhooks
  assinam os bytes exatos recebidos, nunca um JSON reserializado.
- Resolver a conexão por id SEM contexto de tenant (necessário para verificar a assinatura antes de
  saber o tenant) usa `app.resolve_integration_connection` (migração `0031`), mesmo padrão de
  `app.resolve_oauth_app` (parte 1 desta ADR).

## Limitações documentadas (escopo deliberadamente reduzido)

- **Microsoft Teams sem slash command/mensagem interativa**: só a notificação de saída (Incoming
  Webhook/connector) está coberta. Suporte a comando/interação exigiria o Bot Framework da Microsoft,
  fora de escopo nesta entrega.
- **Link preview do Slack não chama `chat.unfurl` de volta**: a integração Slack, por BYOK, só guarda a
  Incoming Webhook URL e o signing secret — nenhum bot token com escopo `links:read`/`links:write`. O
  endpoint de `link_shared` monta e devolve o payload de unfurl pronto na resposta HTTP, mas não há como
  empurrá-lo de volta ao Slack sem esse token. Documentado para quando o app ganhar esse escopo.
- **Reconciliação de exclusão no Microsoft Graph é best-effort**: uma listagem simples de eventos não
  devolve itens excluídos (precisaria de `/me/events/delta`, fora de escopo); a reconciliação de DATA
  MOVIDA funciona normalmente nos dois provedores.
- **E-mail-para-item**: a pluimbing de polling (Gmail/Graph) + watermark fica pronta, mas o encaminhamento
  final usa o MESMO webhook público de e-mail recebido já existente (`POST /v1/email/inbound`,
  `MailInboundService.ingest`) em vez de reimplementar o parser — ainda não tem teste automatizado
  dedicado (ver relatório da entrega).
- **Notificação por chat não usa o motor de entrega de webhooks (ADR 0051)**: é um fetch POST direto,
  melhor esforço, sem fila/retentativa própria — o motor de webhooks é para o tenant assinar os
  PRÓPRIOS eventos de domínio, um conceito diferente de notificar uma pessoa por preferência de canal.

## Alternativas consideradas

- **Guardar o app OAuth do tenant dentro de `integration_connections.metadata`**: rejeitado — o app é
  um dado de workspace inteiro, a conexão é por usuário; misturar os dois faria o app "sumir" se a
  primeira pessoa a conectar se desconectasse.
- **Depender do cookie de sessão no callback OAuth**: rejeitado — o redirect entre domínios não garante
  isso de forma confiável; o precedente de login já usa estado opaco no Redis, então a conexão de
  integração faz o mesmo.
- **Iterar toda coluna `status` do board para o auto-avanço sem filtrar por nº de categorias**: tentado
  e descartado ao rodar o E2E contra o seed PMSP — avançava "OS solicitada" para "Sim" em vez do
  `c_status` real, exatamente o tipo de erro que a heurística deveria evitar.
- **UPDATE SQL direto para reconciliar calendário → item**: rejeitado — quebraria auditoria, outbox e
  tempo real; o padrão `runAsSystem` já estabelecido (ADR 0049/0055) foi reaproveitado sem exceção.

## Consequências

- Conectar Google/Microsoft exige que o workspace já tenha seu próprio app OAuth cadastrado no Google
  Cloud Console/Azure AD — mais fricção inicial que um app multi-tenant da plataforma, aceito pelo
  princípio BYOK do produto (mesma troca já aceita para IA e webhooks).
- Toda integração webhook-only é do workspace inteiro; não há hoje uma forma de um usuário individual
  ter sua própria conexão Slack/GitHub — consistente com o fato de que o segredo também é único por
  workspace.
- A heurística de auto-avanço de status é conservadora por design: num board com várias colunas de
  status ambíguas, pode optar por NÃO avançar nenhuma — melhor não adivinhar do que corromper um status
  não relacionado, mesmo às custas de exigir configuração manual em boards atípicos.

## Adendo — SDK TypeScript (`packages/sdk`)

- **Pacote novo, não publicado em registro**: `@cube-track/sdk` gera seus tipos a partir de
  `docs/openapi.json` (via `openapi-typescript`) e expõe um cliente fino hand-rolled por cima de
  `fetch` — mesmo espírito de `apps/web/src/lib/api/client.ts`, mas autenticado sempre por
  `Authorization: Bearer <token ctk_...>` (nunca cookie de sessão), pensado para ser usado FORA do
  monorepo. Rejeitado o uso de uma biblioteca de geração de cliente em runtime (ex.: `openapi-fetch`
  como dependência) — convenção do projeto favorece código explícito sobre glue generator.
- **Único pacote de `packages/*` com `build` de verdade (`tsup`, ESM + `.d.ts`)**: os demais pacotes
  internos (`shared`, `ui`, `i18n`, `db`, `testing`) não têm `build` porque são consumidos como
  código-fonte TypeScript dentro do monorepo (`apps/api`/`apps/web` compilam/empacotam esse código-fonte
  diretamente). O SDK precisa compilar para JS+`.d.ts` porque, por definição, é para ser usado por quem
  NÃO está dentro deste monorepo (não tem como "consumir TypeScript-fonte via workspace"). `tsup` foi
  escolhido por já ser a ferramenta de build usada em `apps/api`/`apps/worker` (mesma convenção,
  `dts: true` a mais para gerar declarações).
- **Bug de bundling do exportador OpenAPI, contornado sem tocar em `apps/api`**: para os poucos schemas
  recursivos do produto (condições de filtro de views/saved-filters, `showWhen` de formulário
  condicional), o exportador emite um `$defs` LOCAL aninhado dentro do schema de cada rota, com
  `$ref: "#/$defs/__schema0"` — um JSON Pointer absoluto que só resolveria contra um `$defs` na RAIZ do
  documento. `openapi-typescript`/Redocly falham ao validar isso. As 16 ocorrências no documento atual
  são byte-a-byte idênticas (mesmo tipo recursivo reaproveitado), então `packages/sdk/scripts/generate.mjs`
  faz o _hoist_ desse `$defs` para a raiz — conferindo que todas as ocorrências batem antes de unificar,
  e lançando erro caso não batam — só na cópia em memória usada para gerar `src/generated/schema.ts`.
  `docs/openapi.json` e `apps/api` (fora do escopo desta entrega) ficam intocados; o bug de origem (no
  exportador Swagger/zod da API) fica registrado aqui para quem for corrigi-lo na raiz depois.
