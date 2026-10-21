# Painel do item

Referência do painel de detalhe do item (Prompt 7): atualizações com @menções e resposta por e-mail, arquivos, log de atividade, campos, checklist, dependências/relacionados, aprovações e seguir. Decisões de arquitetura em `docs/adr/0048-painel-do-item.md`.

## 1. Abrir o painel

- Drawer com URL própria: `?item=<id>` na rota do board (`/w/:workspaceId/b/:boardId`), não uma rota dedicada — a Tabela/Kanban continuam atrás. `apps/web/src/features/collaboration/item-panel.tsx`.
- Entradas: ícone "Abrir" que aparece ao passar o mouse na linha da Tabela (`grid-rows.tsx`), ou clicar num cartão do Kanban (`onOpenItem`).
- Anterior/próximo navegam na ordem **atualmente visível** na view (respeita filtro, ordenação, grupos recolhidos). A Tabela e o Kanban publicam essa ordem numa store Zustand efêmera (`item-panel-store.ts`, `setItemPanelOrder`) sempre que a lista renderizada muda; o painel só lê.
- Presença: assina a room `item` (`useItemRealtime`) além da room do board — quem mais tem o painel do mesmo item aberto aparece no topo (`useItemPresence`).
- Ao abrir, marca o item como lido (`POST /v1/items/:id/seen`, zera `unreadUpdates`).

## 2. Abas

| Aba           | Dados                                                                | Permissão para escrever                  |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Atualizações  | `GET/POST /v1/items/:id/updates`, `/replies`, `/reactions`, `/pin`     | `item.comment` (postar/reagir), `item.update` (fixar, moderar) |
| Arquivos      | `GET /v1/items/:id/files`, upload por URL pré-assinada, versões       | `file.upload` (board), excluir exige `item.update` |
| Atividade     | `GET /v1/items/:id/activity` (+ `/actors`), filtros usuário/coluna/período | somente leitura                        |
| Campos        | reaproveita `ValueEditor`/`ValueField` da Tabela (mesmo editor por tipo de coluna) | igual à Tabela (`canWriteColumn`)    |
| Subitens      | checklists: `GET/POST /v1/items/:id/checklists`, itens              | `item.update`                              |
| Dependências  | reaproveita `DependencyEditor` (Prompt 5) + lista de sucessoras (leitura) | `schedule.manage` (via `item.update`) |
| Aprovações    | `GET/POST /v1/items/:id/approvals`, `/decide`, `/cancel`             | pedir/cancelar: `item.update`; decidir: só o aprovador designado |

Nenhuma permissão nova foi criada — ver `docs/permissions.md` §7.

## 3. Atualizações, respostas e @menções

- Corpo é um documento Tiptap (JSON) validado estruturalmente no domínio, não campo a campo no schema REST (`DocSchema = z.record(...)`); `packages/shared/src/richtext.ts` extrai texto plano (`docToPlainText`) e menções (`extractMentions`).
- Nó de menção: `{type:'mention', attrs:{kind:'user'|'team'|'everyone', id, label}}` — `id` é o UUID alvo **sem prefixo** (mesma convenção do seed). "Todos" notifica os seguidores do board, não o tenant inteiro.
- Editar substitui as menções gravadas (zera e regrava) mas **não** reenvia notificação — só a criação dispara `update.created`/`reply.created`, que o worker escuta para notificar.
- Histórico de edição (`edit_history`, jsonb) guarda cada versão anterior do corpo; nunca é apagado.
- Reações: emoji livre (até 32 chars), alternar (mesmo emoji pela mesma pessoa remove).

### Resposta por e-mail

- Cada notificação de menção carrega um endereço de resposta próprio (`reply+<payload base64url>.<hmac>@<MAIL_REPLY_DOMAIN>`); responder a esse e-mail chama `POST /v1/email/inbound` (webhook público, autenticado por `X-Webhook-Secret`), que grava a resposta com `source: 'email'` e remove a citação do corpo antes de gravar.
- Em dev, aponte o provedor de e-mail (ou um teste) para `${API_URL}/v1/email/inbound` com o segredo de `INBOUND_EMAIL_WEBHOOK_SECRET`; `MAIL_REPLY_DOMAIN` define o domínio dos endereços de resposta.

## 4. Log de atividade

- Todas as mudanças de campo do item (nativo ou coluna), mais eventos específicos do painel (`checklist_item.toggle`, `file.uploaded`/`file.delete`, `approval.request`/`approval.decide`) aparecem aqui — é a mesma tabela `activity_logs` gravada por `DomainEvents.recordChange` em todas as escritas do sistema, não algo exclusivo do painel.
- Filtros: `actorId`, `columnKey`, `from`/`to` (ISO datetime), paginação por cursor (`decodeCursor`/`encodeCursor`).

## 5. Checklists

- Vários checklists por item; cada um com itens (`content`, `isDone`, `assigneeId`, `dueDate`) ordenados por fractional index (`positionBetween`). Progresso (`done`/`total`) é calculado na leitura, não armazenado.

## 6. Dependências e itens relacionados

- **Reaproveitado, não duplicado**: predecessoras usam o mesmo `DependencyEditor`/`PUT /v1/items/:id/dependencies` do Prompt 5 (detecção de ciclo no grafo inteiro do board). A aba só acrescenta uma lista somente-leitura de **sucessoras** (itens que dependem deste).
- Colunas de relação (`board_relation`, "itens relacionados") já aparecem e são editáveis na aba **Campos**.

## 7. Aprovações

- Modo `any` (qualquer aprovador decide) ou `all` (todos precisam aprovar) — `packages/shared`/`domain/approval.ts#resolveApprovalStatus` resolve o status a cada decisão. Só o aprovador designado pode decidir; cancelar é `item.update`.

## 8. Eventos realtime novos

`packages/shared/src/events.ts` — documentados também em `docs/realtime-events.md`:

| Evento               | Payload                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `update.created`      | `{updateId, itemId, authorId, bodyText}`                               |
| `update.changed`      | `{updateId, itemId, change: 'edited'|'deleted'|'pinned'|'unpinned'}`    |
| `reply.created`       | `{replyId, updateId, itemId, authorId, bodyText}`                      |
| `reply.changed`       | `{replyId, updateId, itemId, change: 'edited'|'deleted'}`              |
| `reaction.changed`    | `{targetType: 'update'|'reply', targetId, itemId}`                     |
| `attachment.changed`  | `{attachmentId, itemId, change: 'uploaded'|'deleted'}`                 |
| `checklist.changed`   | `{itemId, checklistId}`                                                |
| `approval.changed`    | `{requestId, itemId, status, requestedBy, approverIds?}` (`approverIds` só na criação) |

Entregues tanto na room do board quanto na room do item (`fanout.service.ts` já fazia isso desde o Prompt 5 para `item.*`; os eventos acima reaproveitam o mesmo mecanismo). No frontend, `apps/web/src/realtime/apply.ts` invalida as consultas do painel (`qk.updates`, `qk.replies`, `qk.checklists`, `qk.approvals`, `qk.itemFiles`, `qk.activity`) e ajusta os indicadores da linha (`updates`, `unreadUpdates`, `attachments`) sem esperar um recarregamento.

## 9. Escopo cortado nesta entrega (documentado, não escondido)

- **Menção a time**: schema e domínio já suportam (`mentionAttrs.team`), mas a UI de sugestão só lista usuários e "todos" — não existe tela de gestão de times no frontend ainda.
- **Yjs/Hocuspocus**: previsto na ADR 0007 para edição colaborativa de documentos longos; atualizações/respostas são postagens atômicas, não um documento compartilhado, então não precisam de CRDT nesta entrega.
- **Pré-visualização de Office** (Word/Excel/PowerPoint): a aba Arquivos pré-visualiza imagem e PDF inline; os demais formatos só oferecem download (sem visualizador externo configurado).
- **E2E do fluxo de e-mail**: validado no nível de API (`apps/api/test/collaboration.e2e.test.ts`, webhook assinado) — não há teste de navegador para isso porque não existe cliente de e-mail real no ambiente de teste.

## 10. Como rodar e testar

```bash
pnpm --filter @cube-track/api test                 # updates/replies/reações/atividade/checklists/seguir/aprovações/webhook
pnpm --filter @cube-track/worker test               # notificações (menção, aprovação) e indexação
pnpm --filter @cube-track/shared test               # richtext, mail-reply
pnpm --filter @cube-track/web test                  # mention-candidates, realtime apply
pnpm --filter @cube-track/web test:e2e -- item-panel.spec.ts   # dois navegadores: deep link, menção, atividade, checklist, aprovação
```
