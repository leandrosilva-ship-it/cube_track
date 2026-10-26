# Eventos em tempo real

> Contrato tipado em `packages/shared/src/events.ts` (`EVENT_PAYLOADS`, `RealtimeEvent`, `rooms`). O gateway fica em `apps/api/src/modules/realtime`. Decisões nas ADRs 0007, 0008 e 0027.

## 1. Conexão

- **Transporte:** Socket.IO (path padrão `/socket.io`) com adapter Redis, para que vários nós funcionem como um só.
  - Com `REALTIME_MODE=embedded`, o gateway roda no processo da API.
  - Com `separate`, roda em `main.realtime` (porta `REALTIME_PORT`).
- **Autenticação no handshake:** o cliente envia `auth: { token: '<access token>' }` (ou o header `Authorization: Bearer`).
  - Token inválido ou ausente: o servidor emite `auth_error` e desconecta.
  - Token válido: o servidor emite `ready` com `{ userId, tenantId }`.
  - Todo socket entra automaticamente nas rooms do **tenant** e do **usuário**.
- **Renovação:** antes de o access token expirar (10 min), o cliente chama `auth.refresh` com `{ token }`.
  - O novo token precisa ser do mesmo usuário e da mesma sessão.
  - Se o token expirar sem renovação, o servidor emite `auth_error` com `token_expired` e desconecta.
- **Comandos:** todas as alterações passam pela API REST. Qualquer outro evento enviado pelo cliente recebe `{ ok: false, error: { code: 'commands_via_rest' } }`.

## 2. Mensagens cliente → servidor (com ack)

| Evento               | Corpo                                                                    | Resposta (ack)                                                                                |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `subscribe`          | `{ room: 'board' \| 'item' \| 'dashboard', id, lastSeq? }`               | `{ ok, room, presence[], replay? }`. Se negado: `{ ok: false, error: { code: 'forbidden' } }` |
| `unsubscribe`        | `{ room, id }`                                                           | `{ ok }`. Emite `presence.left` se o usuário estava presente                                  |
| `presence.heartbeat` | `{ room, id, state: { viewId?, editing?: { itemId, field }, typing? } }` | `{ ok }`. Exige assinatura prévia da room                                                     |
| `auth.refresh`       | `{ token }`                                                              | `{ ok }` ou `{ ok: false, error: { code: 'token_mismatch' } }`                                |

`subscribe` verifica a permissão: `board.read` para boards, `item.read` para itens (o que inclui o escopo do convidado) e `dashboard.read` para dashboards.

## 3. Envelope servidor → cliente (`event`)

```ts
interface RealtimeEvent {
  eventId: string; // UUIDv7 — chave de deduplicação
  type: RealtimeEventType;
  tenantId: string;
  scope: { boardId; itemId; userId; dashboardId }; // define a room de entrega
  seq: number | null; // sequência monotônica por board (null fora de board)
  actor: { userId: string | null; kind: 'user' | 'automation' | 'api' | 'import' | 'system' };
  clientMutationId: string | null; // eco do header X-Client-Mutation-Id
  occurredAt: string; // ISO-8601 UTC
  payload: /* por tipo, abaixo */;
  schemaVersion: 1;
}
```

## 4. Tipos de evento

| Tipo                          | Room                 | Payload                                                                                                                          | Origem                                                                                                                                                              |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item.created`                | board                | `{ item: ItemSnapshot, reason? }` (`created`, `duplicated`, `restored`, `moved`, `imported`)                                     | criar, duplicar, restaurar, mover para o board, importar                                                                                                            |
| `item.updated`                | board + item         | `{ itemId, version, changes: [{ field, kind: 'column'\|'native', value, version }] }`                                            | `PATCH /v1/items/:id`, automações, cronograma                                                                                                                       |
| `item.deleted`                | board + item         | `{ itemId, reason? }` (`deleted`, `archived`, `moved`)                                                                           | excluir (lixeira), arquivar, mover para outro board                                                                                                                 |
| `item.button_clicked`         | board + item         | `{ itemId, columnKey }`                                                                                                          | clique numa coluna `button` (ADR 0051) — dispara automações do tipo `button_clicked`                                                                                |
| `group.changed`               | board                | `{ groupId, change, changes? }` (`created`, `updated`, `deleted`, `archived`, `restored`, `moved`)                               | CRUD de grupos; o cliente recarrega a estrutura (e os itens, exceto em `updated`)                                                                                   |
| `column.created`              | board                | `{ columnId, key }`                                                                                                              | `POST /v1/boards/:id/columns` e duplicar coluna                                                                                                                     |
| `column.deleted`              | board                | `{ columnId, key }`                                                                                                              | `DELETE /v1/boards/:id/columns/:columnId`                                                                                                                           |
| `column.updated`              | board                | `{ columnId, key, changes }`                                                                                                     | `PATCH …/columns/:columnId`, rótulos, opções; mudanças só de título/largura/posição recarregam apenas a estrutura                                                   |
| `board.updated`               | board                | `{ boardId, changes }`                                                                                                           | alterações de board                                                                                                                                                 |
| `update.created`              | board + item         | `{ updateId, itemId, authorId, bodyText }`                                                                                       | postar uma atualização no item (painel do item, ADR 0048)                                                                                                           |
| `update.changed`              | board + item         | `{ updateId, itemId, change: 'edited'\|'deleted'\|'pinned'\|'unpinned' }`                                                        | editar, excluir, fixar ou desafixar uma atualização                                                                                                                 |
| `reply.created`               | board + item         | `{ replyId, updateId, itemId, authorId, bodyText }`                                                                              | responder a uma atualização                                                                                                                                         |
| `reply.changed`               | board + item         | `{ replyId, updateId, itemId, change: 'edited'\|'deleted' }`                                                                     | editar ou excluir uma resposta                                                                                                                                      |
| `reaction.changed`            | board + item         | `{ targetType: 'update'\|'reply', targetId, itemId }`                                                                            | alternar uma reação (emoji) numa atualização ou resposta                                                                                                            |
| `attachment.changed`          | board + item         | `{ attachmentId, itemId, change: 'uploaded'\|'deleted' }`                                                                        | upload concluído ou exclusão de um arquivo do item                                                                                                                  |
| `checklist.changed`           | board + item         | `{ itemId, checklistId }`                                                                                                        | criar/renomear/excluir checklist, ou adicionar/editar/excluir/marcar item                                                                                           |
| `approval.changed`            | board + item         | `{ requestId, itemId, status, requestedBy, approverIds? }` (`approverIds` só na criação)                                         | pedir aprovação (status `pending`) ou decidir/cancelar (status final)                                                                                               |
| `milestone.changed`           | board                | `{ milestoneId, boardId, change }` (`created`, `updated`, `deleted`)                                                             | CRUD de marcos do board (ADR 0049) — o cliente invalida a lista de marcos e os dados do Gantt                                                                       |
| `baseline.changed`            | board                | `{ baselineId, boardId, change }` (`captured`, `primary_changed`, `deleted`)                                                     | capturar, trocar a primária ou excluir uma baseline (ADR 0049) — o cliente invalida a lista e o detalhe aberto                                                      |
| `dashboard.changed`           | dashboard            | `{ dashboardId, change }` (`created`, `updated`, `deleted`)                                                                      | CRUD de dashboard (ADR 0050) — o cliente invalida o dashboard e a lista de dashboards do workspace                                                                  |
| `widget.changed`              | dashboard            | `{ widgetId, dashboardId, change }` (`created`, `updated`, `deleted`, `reordered`)                                               | CRUD de widget (ADR 0050) — o cliente invalida a lista de widgets e os dados do dashboard                                                                           |
| `project_health.reported`     | board                | `{ healthId, boardId }`                                                                                                          | novo relato de saúde do projeto (ADR 0050) — o cliente invalida o histórico e os dados de dashboards em cache                                                       |
| `automation.changed`          | board ou tenant      | `{ automationId, workspaceId, boardId, change }` (`created`, `updated`, `deleted`)                                               | CRUD de automação (ADR 0051) — `boardId` nulo (automação de workspace inteiro) entrega por tenant                                                                   |
| `phase.changed`               | board                | `{ phaseId, boardId, change }` (`created`, `updated`, `deleted`, `reordered`)                                                    | CRUD de fase de um board `kind: 'process'` (ADR 0051) — o cliente recarrega o pipe e o Kanban                                                                       |
| `process_config.changed`      | board                | `{ boardId, change }` (`pipe_created/updated/deleted`, `transition_rule_created/updated/deleted`, `sla_created/updated/deleted`) | CRUD do pipe, de regras de transição ou de definições de SLA (ADR 0051) — o cliente recarrega `GET .../process`                                                     |
| `sla.changed`                 | board                | `{ trackerId, itemId, boardId, status }` (`running`, `warning`, `paused`, `met`, `breached`, `stopped`)                          | mudança de estado do acompanhamento de SLA (ADR 0051) — atualiza o indicador no item/cartão                                                                         |
| `webhook.changed`             | board ou tenant      | `{ webhookId, workspaceId, boardId, change }` (`created`, `updated`, `deleted`, `enabled`, `disabled`)                           | CRUD de webhook de saída (ADR 0051), incluindo desabilitação automática após falhas consecutivas — `boardId` nulo (webhook de workspace inteiro) entrega por tenant |
| `workspace.structure_changed` | tenant               | `{ workspaceId }`. O cliente recarrega a árvore (já filtrada por permissão)                                                      | pastas, boards, ordem (ADR 0035)                                                                                                                                    |
| `view.changed`                | board                | `{ boardId, viewId }`                                                                                                            | criar, editar, duplicar ou excluir views                                                                                                                            |
| `favorites.changed`           | usuário              | `{}`                                                                                                                             | adicionar ou remover favoritos (sincroniza as abas do usuário)                                                                                                      |
| `notification.created`        | usuário              | `{ notificationId, type, title, itemId, boardId }`                                                                               | worker (menções, automações)                                                                                                                                        |
| `permission.changed`          | tenant               | `{ scope, resourceId }`                                                                                                          | papéis, concessões, membros                                                                                                                                         |
| `session.revoked`             | usuário (sessão)     | `{ sessionId }`. O socket da sessão é desconectado                                                                               | logout, revogação, reuso de refresh token                                                                                                                           |
| `presence.joined`             | board/item/dashboard | `{ room, userId, state }`                                                                                                        | heartbeat                                                                                                                                                           |
| `presence.updated`            | board/item/dashboard | `{ room, userId, state }`                                                                                                        | heartbeat com estado alterado                                                                                                                                       |
| `presence.left`               | board/item/dashboard | `{ room, userId }`                                                                                                               | unsubscribe, desconexão ou TTL                                                                                                                                      |
| `sequence.skipped`            | board                | `{}` (mantém a continuidade de `seq`)                                                                                            | evento não visível para o destinatário                                                                                                                              |

## 5. Redação por destinatário

Cada nó entrega eventos de board só para os seus sockets locais, redigidos **por usuário** (`redactEventFor`):

- os valores e as `changes` de **colunas ocultas** são removidos, inclusive campos nativos vinculados a colunas ocultas;
- convidado com escopo `assigned` recebe `sequence.skipped` quando o item não é dele (antes e depois da mudança, via `routing.assigneeIds`);
- os metadados de roteamento (`routing`) nunca chegam ao cliente.

É a mesma regra aplicada em REST e GraphQL (ver `docs/permissions.md` §5).

## 6. Ordem, reconexão e reconciliação

1. Os eventos de um board têm `seq` contíguo, atribuído por `boards.seq` na transação da escrita. O outbox é o log de replay.
2. O cliente guarda o último `seq` aplicado por board. Ao reconectar, envia `subscribe` com `lastSeq`, ou chama `GET /v1/boards/:id/events?after=<seq>`.
3. A resposta traz `{ events, resyncRequired, seq }`. Se `resyncRequired` for `true` (lacuna, retenção expirada ou mais de 500 eventos), o cliente recarrega o board por REST.
4. **Deduplicação:** o mesmo `eventId` pode chegar pelo fast path da API e pelo relay do outbox. Servidor e cliente descartam duplicatas.
5. **Conflitos (LWW por campo):**
   - Cada campo tem uma `version`. O cliente aplica uma mudança só se a `version` recebida for maior que a local.
   - Escritas enviam `baseVersions`; se divergirem, a API responde 409 com o valor atual.
6. **Eco otimista:** o cliente envia `X-Client-Mutation-Id` nas escritas. O evento correspondente traz o mesmo `clientMutationId` e confirma o patch otimista.

## 7. Caminho de um evento

```
API (transação): escrita + auditoria + outbox(seq) ──commit──► PUBLISH cube:realtime:events (fast path)
Worker (OutboxRelay): SELECT … FOR UPDATE SKIP LOCKED ► PUBLISH (garantia) ► filas BullMQ ► published_at
Nós realtime: SUBSCRIBE ► dedupe por eventId ► redação por socket ► emit('event')
```

- `item.updated` também é emitido pelo worker ao recalcular espelhos, rollups e progresso por subitens (ADR 0038), e por `dependencies` ao alterar predecessores.
- Na Tabela, células alteradas por outra pessoa recebem destaque visual por 2,5 s.
- Latência medida no teste automatizado (`apps/api/test/realtime.e2e.test.ts`, dois clientes): p95 de cerca de 64 ms, abaixo da meta de 300 ms.
- Métricas Prometheus: `cube_realtime_events_delivered_total`, `cube_realtime_propagation_ms` e `cube_realtime_connections`.

## 8. Presença

- Armazenada no Redis: um ZSET por room (score = último heartbeat) e um HASH com o estado.
- O cliente envia heartbeat a cada **10 s**. A entrada expira em **30 s** sem heartbeat.
- `subscribe` devolve a lista atual de presença. As mudanças chegam como `presence.*`.
