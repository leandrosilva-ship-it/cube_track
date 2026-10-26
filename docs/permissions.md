# Permissões (RBAC em 5 níveis)

> Implementação: regras puras em `packages/shared/src/permissions.ts` (`decide`), carga e cache em `apps/api/src/modules/access` (`AccessService.can`). Os testes estão em `permissions.test.ts`, `effective-access.test.ts` e `apps/api/test/access.e2e.test.ts`.

## 1. Níveis

| Nível     | Recurso         | Onde é concedido                                                                    |
| --------- | --------------- | ----------------------------------------------------------------------------------- |
| Tenant    | Organização     | Papel da associação (`memberships.role_id`)                                         |
| Workspace | Workspace       | Workspace aberto (papel implícito) + `access_grants` (`workspace`)                  |
| Board     | Board           | Herança do workspace (boards "main") + `access_grants` (`board`)                    |
| View      | View salva      | Dono (view pessoal), `views.is_restricted` / `is_locked` + `access_grants` (`view`) |
| Coluna    | Coluna do board | `column_definitions.permissions` (`viewers` / `editors` por papel, usuário ou time) |
| Item      | Item            | Escopo de itens do convidado + `access_grants` (`item`)                             |

## 2. Papéis

Os papéis de sistema são criados em todo tenant (`packages/db/src/provisioning.ts`). Papéis customizados podem ser criados por quem tem `roles.manage`, por meio de `POST /v1/roles`, informando o escopo `tenant`, `workspace` ou `board`.

| Papel (tenant) | Permissões de tenant                 | Observação                                                              |
| -------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `owner`        | todas                                | acesso total a todos os workspaces e boards                             |
| `admin`        | todas, exceto `tenant.billing`       | acesso total a todos os workspaces e boards                             |
| `member`       | `workspace.create`, `members.invite` | papel implícito `workspace_member` em workspaces abertos                |
| `viewer`       | —                                    | papel implícito `workspace_viewer` em workspaces abertos                |
| `guest`        | —                                    | **somente** concessões explícitas; vê apenas itens em que é responsável |

| Papel               | Escopo    | Permissões principais                                                                                                                              |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_admin`   | workspace | `workspace.manage`, `folder.manage`, `board.create`, `portfolio.manage`, contratos…                                                                |
| `workspace_member`  | workspace | `workspace.read`, `board.create`, `dashboard.create`, `portfolio.read`, `contract.read`                                                            |
| `workspace_viewer`  | workspace | `workspace.read`, `portfolio.read`                                                                                                                 |
| `board_owner`       | board     | editor + `board.manage`, `board.share`, `column.manage`, `automation.manage`, `form.manage`, `schedule.manage`, `process.manage`, `webhook.manage` |
| `board_editor`      | board     | `board.read`, `board.export`, `group.manage`, `view.manage`, `item.create/update/delete`, `item.comment`, `file.upload`, `timesheet.log`           |
| `board_contributor` | board     | `board.read`, `item.update_assigned`, `item.comment`, `file.upload`, `timesheet.log`                                                               |
| `board_viewer`      | board     | `board.read`, `item.comment`                                                                                                                       |

## 3. Permissões efetivas

`AccessService` monta um **retrato** (`PrincipalAccess` + `WorkspaceAccess` + `BoardAccess`) por usuário e recurso:

1. **Tenant owner/admin**: recebem todas as permissões de workspace e de board.
2. **Workspace aberto** (`workspaces.visibility = 'open'`): membros recebem `workspace_member` e leitores recebem `workspace_viewer`. Convidados nunca recebem herança.
3. **Boards "main"** herdam do workspace:
   - `workspace_admin` → `board_owner`;
   - `workspace_member` → `board_editor`;
   - `workspace_viewer` → `board_viewer`.
     Boards **privados** e **compartilháveis** exigem concessão explícita.
4. **Concessões explícitas** (`access_grants`) ao usuário ou a um de seus **times** são unidas às anteriores. Concessões expiradas (`expires_at`) são ignoradas.
5. **Convidado**: `itemScope = 'assigned'`, a menos que o board defina `guest_item_visibility = 'all'`. Ele lê e edita só itens em que ele, ou um time dele, aparece numa coluna `people`. Uma concessão `item` abre um item específico.

## 4. Regras por ação (`decide`)

- **Board**: a ação precisa estar em `BoardAccess.permissions`.
- **Item**:
  - `item.read` exige `board.read` e o escopo de itens (ou uma concessão no item).
  - `item.update` exige `item.update`, ou `item.update_assigned` quando o usuário é responsável pelo item.
- **Coluna**:
  - `column.read`: quem tem `board.manage` lê tudo. Os demais leem conforme a lista `viewers`; lista vazia significa todos.
  - `column.update`: exige a leitura da coluna, o direito de editar o item e a presença na lista `editors` (ou `board.manage`).
- **View**:
  - Uma view pessoal só é visível para o dono.
  - Uma view restrita é visível só com concessão explícita ou `board.manage`.
  - Uma view travada só pode ser editada por quem tem `board.manage`.
- **Dashboard**: o dono sempre tem acesso. Com visibilidade `workspace`, quem tem `workspace.read` pode ler e quem tem `workspace.manage` pode editar.

Um recurso sem leitura responde **404**, nunca 403, para não revelar que ele existe. Uma ação negada sobre um recurso legível responde **403** (`problem+json`, `code: forbidden`).

## 5. Colunas ocultas — mesma regra em todos os canais

Os valores de colunas que o usuário não pode ler (`hiddenColumnKeys`) são removidos:

| Canal     | Onde                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REST      | `toItemDto` / `redactValues`. Filtros e ordenação por coluna oculta são rejeitados (403 `column_forbidden`).                                                             |
| GraphQL   | mesmos serviços de aplicação (`WorkResolver` usa `ItemsService`)                                                                                                         |
| WebSocket | `redactEventFor`: remove `values`/`changes` de colunas ocultas, inclusive campos nativos vinculados (`binding`); para convidados fora do escopo envia `sequence.skipped` |
| Replay    | `GET /v1/boards/:id/events` e `subscribe` com `lastSeq` aplicam a mesma redação                                                                                          |
| Busca     | o Meilisearch não indexa valores de colunas customizadas. Os resultados são filtrados por boards legíveis e, para convidados, por `assigneeIds`                          |

A escrita numa coluna sem permissão de edição, ou num campo nativo vinculado a uma coluna oculta, responde 403.

## 6. Cache e invalidação

- As chaves no Redis seguem o formato `acl:{tenant}:{versão}:{tipo}:{…}`, com TTL de 300 s.
- Qualquer mudança de papel, concessão, associação ou time faz `INCR acl:{tenant}:version` **após o commit**. Isso invalida o tenant inteiro sem varrer chaves.
- As mudanças de permissão emitem `permission.changed`, que avisa os clientes para recarregar o que estiver aberto.

## 7. API

| Rota                                | Uso                                                         |
| ----------------------------------- | ----------------------------------------------------------- |
| `GET/POST/PATCH/DELETE /v1/roles`   | papéis (customizados editáveis; de sistema somente leitura) |
| `GET/POST/DELETE /v1/access-grants` | concessões em workspace, board, view ou item                |
| `GET/PATCH /v1/members`             | papel e status de membros e convidados                      |
| `POST /v1/access/check`             | `can(usuário, ação, recurso)`                               |
| `GET /v1/me/permissions?boardId=`   | permissões efetivas, escopo de itens e colunas ocultas      |

### Navegação e estrutura (Prompt 4, ADR 0035)

| Rota                                                              | Permissão exigida                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /v1/workspaces`                                             | `workspace.create` (tenant)                                                    |
| `GET /v1/workspaces/:id/tree`                                     | leitura do workspace; convidados recebem só os boards concedidos, sem pastas   |
| `POST /v1/workspaces/:id/folders`, `PATCH/DELETE /v1/folders/:id` | `folder.manage` no workspace                                                   |
| `POST /v1/workspaces/:id/boards`                                  | `board.create` no workspace; o criador recebe `board_owner`                    |
| `PATCH /v1/boards/:id`                                            | `board.manage` (nome e descrição); mover entre pastas exige `folder.manage`    |
| `GET/PUT/DELETE /v1/me/favorites`                                 | leitura do recurso favoritado (`board.read` ou `workspace.read`)               |
| `GET /v1/boards/:id/views`                                        | `board.read`; cada view é filtrada por `view.read`                             |
| `POST /v1/boards/:id/views`                                       | `view.manage` (compartilhada) ou `board.read` (pessoal)                        |
| `PATCH/DELETE /v1/views/:id`                                      | `view.update`; a view padrão não pode ser excluída                             |
| `GET /v1/me/notifications`, `GET /v1/me/week`                     | próprio usuário; "Minha semana" respeita colunas ocultas e escopo de convidado |

### Views, link público e filtros salvos (Prompt 6, ADRs 0044, 0046, 0047)

| Rota                                                                      | Permissão exigida                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `POST /v1/views/:id/duplicate`                                            | `view.read` na origem; `view.manage` (cópia compartilhada) ou `board.read` (pessoal) |
| `PATCH /v1/views/:id` com `isDefault`/`isLocked`/`isRestricted`           | `view.manage` no board, além de `view.update`                                        |
| `GET/PUT/DELETE /v1/views/:id/share-link`                                 | `board.share` no board da view                                                       |
| `GET /v1/public/share/:token/info`, `POST /v1/public/share/:token/verify` | nenhuma (link válido, não revogado/expirado; senha se o link exigir)                 |
| `GET /v1/public/share/board`, `GET /v1/public/share/items`                | sessão de link público válida (cabeçalho `X-Share-Session`, 1h)                      |
| `GET/POST /v1/boards/:id/saved-filters`                                   | `board.read` (pessoal) ou `view.manage` (compartilhado)                              |
| `DELETE /v1/saved-filters/:id`                                            | dono do filtro ou `view.manage` no board                                             |
| Transições de status (coluna `status` com `settings.transitions`)         | imposta na escrita do item (`item.update`), não uma permissão própria                |

### Boards, colunas e itens (Prompt 5, ADRs 0038–0042)

| Operação                                                                  | Permissão exigida                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Criar/editar/excluir/duplicar colunas, rótulos, opções e status principal | `column.manage` no board                                                                          |
| Editar valor de célula                                                    | `item.update` (ou `item.update_assigned` em itens atribuídos) **e** permissão de edição da coluna |
| Criar, renomear, colorir, reordenar, duplicar, mover, arquivar grupos     | `group.manage`                                                                                    |
| Criar e duplicar itens; importar planilha                                 | `item.create` (importar com `createMissing` em status/lista também exige `column.manage`)         |
| Edição em massa (`PATCH /v1/boards/:id/items`)                            | as mesmas regras por item e por coluna; o lote inteiro falha se um item for negado                |
| Arquivar, excluir para a lixeira, restaurar, ver a lixeira                | `item.delete`                                                                                     |
| Mover itens entre grupos                                                  | `item.update`; para outro board, também `item.delete` na origem e `item.create` no destino        |
| Exportar CSV/Excel                                                        | `board.export` (colunas ocultas ficam de fora)                                                    |
| Cronômetro e dependências do item                                         | `item.update`                                                                                     |
| Templates (`GET /v1/board-templates`), marcar board como template         | leitura do board de origem; marcar exige `board.manage`                                           |

### Painel do item (Prompt 7, ADR 0048)

Nenhuma permissão nova — todas as ações do painel reaproveitam `item.read`, `item.comment` e `item.update` (ou `schedule.manage`, já existente, para dependências via `item.update`).

| Operação                                                               | Permissão exigida                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Ler atualizações/respostas/atividade/checklists/arquivos/aprovações    | `item.read`                                                                                                            |
| Postar atualização/resposta; reagir (emoji)                            | `item.comment`                                                                                                         |
| Editar/excluir a própria atualização ou resposta                       | autor **ou** `item.update`                                                                                             |
| Fixar/desafixar uma atualização                                        | `item.update`                                                                                                          |
| Criar/renomear/excluir checklist; adicionar/editar/excluir/marcar item | `item.update`                                                                                                          |
| Seguir/deixar de seguir o item                                         | `item.read` (qualquer um que vê o item pode seguir)                                                                    |
| Pedir aprovação; cancelar pedido pendente                              | `item.update`                                                                                                          |
| Decidir um pedido de aprovação (aprovar/rejeitar)                      | ser um dos aprovadores designados daquele pedido (`403 not_an_approver` caso contrário), independente de `item.update` |
| Upload/exclusão de arquivo do item; versões                            | `file.upload` no board (exclusão também exige `item.update` quando o anexo tem item)                                   |

### Cronograma e Formulários (Prompt 8, ADR 0049)

`schedule.manage` e `form.manage` já existiam no mapa de papéis (§2) sem uso até este prompt — agora cobrem Gantt/marcos/baselines/importação e a gestão de formulários, respectivamente. Preencher um formulário (público ou interno) usa as mesmas permissões de escrita de item que a Tabela já exige, nunca `form.manage`.

| Operação                                                                   | Permissão exigida                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Ler dados do Gantt (tarefas, dependências, caminho crítico)                | `board.read`                                                                                                    |
| Arrastar barra (reagendar), alternar marco/modo manual                     | `item.update`                                                                                                   |
| Criar/editar/excluir dependência (predecessores)                           | `item.update` (mesma regra de "Dependências" do painel, §Painel do item)                                        |
| Criar/editar/excluir marco do board (entidade própria, não item)           | `schedule.manage`                                                                                               |
| Capturar/definir primária/excluir baseline                                 | `schedule.manage`                                                                                               |
| Pré-visualizar e confirmar importação de cronograma (MS Project .xml)      | `schedule.manage` + `item.create` no grupo de destino                                                           |
| Criar/editar/excluir formulário e seus campos; emitir/revogar link público | `form.manage`                                                                                                   |
| Preencher formulário internamente (`POST /v1/forms/:id/submit`)            | `item.create` no board do formulário — as mesmas permissões por coluna da Tabela valem para `values`            |
| Preencher formulário público (com token, sem login)                        | nenhuma — autorização é o token + honeypot + captcha, nunca uma permissão de membro                             |
| Preencher formulário público com `requiresLogin`                           | sessão válida do **mesmo tenant** do board (`403 tenant_mismatch` caso contrário) — sem captcha                 |
| `POST /v1/email/inbound` (webhook de resposta por e-mail)                  | nenhuma sessão de usuário — segredo de servidor-a-servidor (`X-Webhook-Secret`), não é uma permissão de usuário |

### Dashboards, widgets e saúde do projeto (Prompt 9, ADR 0050)

A regra de `dashboard.read`/`dashboard.update` em `decide()` já existia desde o Prompt 3 (dono sempre acessa; visibilidade `workspace` segue `workspace.read`/`workspace.manage`) — este prompt só passou a expor `canEdit` no DTO e a usá-la de fato. Não existe uma permissão própria de widget: editar os widgets de um dashboard é editar o dashboard (`dashboard.update`). Relatar a saúde do projeto usa `board.manage` (não uma permissão nova) — o mesmo nível de quem administra o board.

| Operação                                                          | Permissão exigida                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Listar dashboards de um workspace                                 | `workspace.read` (a lista já filtra: privados só do dono, `workspace` para todos que leem o workspace) |
| Criar dashboard                                                   | `dashboard.create` (permissão de workspace, já existia no mapa de papéis, §2)                          |
| Ler um dashboard (`GET /v1/dashboards/:id`)                       | `dashboard.read`                                                                                       |
| Editar/excluir dashboard                                          | `dashboard.update` (dono, ou `workspace.manage` com visibilidade `workspace`)                          |
| Criar/editar/excluir widget de um dashboard                       | `dashboard.update` do dashboard a que ele pertence                                                     |
| Ler dados computados dos widgets (`GET .../data`) ou exportar CSV | `dashboard.read`                                                                                       |
| Relatar saúde do projeto (`POST /v1/boards/:id/project-health`)   | `board.manage`                                                                                         |
| Ler histórico de saúde do projeto                                 | `board.read`                                                                                           |

Agregação de widgets: `widget-data.service.ts` consulta cada board de `config.boardIds` via `ItemsService.list` (mesmo motor da Tabela) — um board que o usuário não pode ler (`board.read` negado) contribui zero itens em vez de derrubar o dashboard inteiro; colunas ocultas e o escopo de itens de convidado valem exatamente como na Tabela.

### Automações, Processos/SLA, Webhooks e preferências de notificação (Prompt 10, ADR 0051)

Três permissões novas de board, cada uma reaproveitada por workspace inteiro quando o recurso é criado sem `boardId` (automações e webhooks aceitam escopo de workspace; `workspace.manage` substitui a permissão de board nesse caso). Transições de fase não têm uma permissão própria — `allowedRoleIds` da regra de transição lista papéis do próprio board, e `board.manage` sempre pode sobrepor.

| Operação                                                                                       | Permissão exigida                                                                                         |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Listar/criar/editar/excluir/duplicar automação de board                                        | `automation.manage` (board) ou `workspace.manage` (automação de workspace)                                |
| Clicar num botão com automação (`POST .../buttons/:columnKey`)                                 | `item.update` do item (mesma permissão de editar o item — não há permissão própria de "clicar botão")     |
| Listar/criar/editar fases, pipe, regras de transição, SLA de um board                          | `process.manage`                                                                                          |
| Mover um item entre fases (transição)                                                          | `item.update` do item **e** (se a regra tiver `allowedRoleIds`) um dos papéis listados, ou `board.manage` |
| Listar webhooks de board / criar / editar / regenerar segredo / excluir                        | `webhook.manage` (board) ou `workspace.manage` (webhook de workspace)                                     |
| Ler/gravar as próprias preferências de notificação (`GET/PUT /v1/me/notification-preferences`) | sessão autenticada — sempre as próprias, nunca as de outra pessoa (não há parâmetro de usuário na rota)   |

`clickButton()` tem uma segunda trava além de `item.update`: a coluna precisa apontar (`settings.automationId`) para uma automação cujo gatilho seja `button_clicked` com o mesmo `columnKey` — sem isso, a API recusa com `button_without_automation`/`button_automation_mismatch` mesmo que a pessoa tenha permissão de editar o item.
