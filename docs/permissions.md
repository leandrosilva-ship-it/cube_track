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

| Papel               | Escopo    | Permissões principais                                                                                                                    |
| ------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_admin`   | workspace | `workspace.manage`, `folder.manage`, `board.create`, `portfolio.manage`, contratos…                                                      |
| `workspace_member`  | workspace | `workspace.read`, `board.create`, `dashboard.create`, `portfolio.read`, `contract.read`                                                  |
| `workspace_viewer`  | workspace | `workspace.read`, `portfolio.read`                                                                                                       |
| `board_owner`       | board     | editor + `board.manage`, `board.share`, `column.manage`, `automation.manage`, `form.manage`, `schedule.manage`, `process.manage`         |
| `board_editor`      | board     | `board.read`, `board.export`, `group.manage`, `view.manage`, `item.create/update/delete`, `item.comment`, `file.upload`, `timesheet.log` |
| `board_contributor` | board     | `board.read`, `item.update_assigned`, `item.comment`, `file.upload`, `timesheet.log`                                                     |
| `board_viewer`      | board     | `board.read`, `item.comment`                                                                                                             |

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
