# ADR 0048 — Painel do item: atualizações por e-mail, menções, aprovações e reaproveitamento de dependências

- **Status:** Aceita
- **Data:** 2026-10-21
- **Prompt:** 7

## Contexto

O painel do item precisa reunir, numa única tela com URL própria (deep link): atualizações colaborativas com @menções e resposta por e-mail, arquivos, log de atividade, campos, checklist, dependências/relacionados, aprovações e seguir. Várias dessas peças já existiam parcialmente desde os Prompts 1–5 (realtime por item, arquivos, dependências de cronograma); o trabalho deste prompt é somar o que falta sem duplicar o que já funciona.

## Decisões

### Modelo de dados e módulo

- Novo módulo `apps/api/src/modules/collaboration/` (Clean Architecture) cobrindo atualizações/respostas/reações, log de atividade (leitura), checklists, seguir e aprovações. Reaproveita `WorkServicesModule` (`ItemsRepository`) em vez de duplicar acesso a itens.
- Tabelas novas: `approval_requests` / `approval_approvers` (RLS própria). `updates`/`replies` ganham `source` (`'app' | 'email'`) e `edit_history` (jsonb, histórico de edições — nunca apagado, só anexado).
- Nenhuma permissão nova: `item.comment` (postar/reagir), `item.update` (fixar, moderar, checklist, pedir aprovação) e `schedule.manage` (dependências, já existente) cobrem todas as ações do painel. Documentado em `docs/permissions.md`.

### Convenção de @menção

- Nó Tiptap `mention` com `attrs = {kind: 'user'|'team'|'everyone', id, label}`, onde `id` é o UUID **sem prefixo** — mesma convenção que o seed (`packages/db/src/seed/context.ts`) já usava. `packages/shared/src/richtext.ts` extrai menções (`extractMentions`), converte doc↔texto plano (para e-mail) e detecta documento vazio.
- "Todos" (`kind: 'everyone'`) notifica os **seguidores do board** (tabela `follows`, `entityType: 'board'`), não todo o tenant — menções em massa ficam contidas a quem already optou por acompanhar aquele board.

### Resposta por e-mail

- Cada atualização/resposta pode nascer de um e-mail de resposta: endereço `reply+<base64url(itemId:userId:updateId)>.<hmac16>@<MAIL_REPLY_DOMAIN>`, assinado com HMAC-SHA256 (reaproveita o padrão de `core/crypto/secrets.ts`, truncado a 16 bytes). `updateId` vazio = nova atualização; presente = resposta a ela. O endereço é gerado pelo worker (`buildReplyAddress`) ao notificar uma menção e também interoperável na API (`ReplyTokenService`) — mesmo segredo (`JWT_SECRET`), mesmo domínio de assinatura (`` `email-reply:${payload}` ``).
- Webhook `POST /v1/email/inbound` é **público** (sem sessão de usuário) e autenticado por um segredo de servidor-a-servidor (`X-Webhook-Secret` / `INBOUND_EMAIL_WEBHOOK_SECRET`), não por login — o provedor de e-mail (ou um teste) é quem chama. Resolve tenant/permissão via função SQL `SECURITY DEFINER` (`app.resolve_item_for_reply`), mesmo padrão dos links públicos de view (ADR 0047), e abre a própria transação (`TransactionRunner.run`) por não ter `TransactionInterceptor` de requisição autenticada.
- Citações (`> ...`, "Em ... escreveu:", `-- `) são removidas do corpo antes de gravar; corpo vazio após a limpeza é rejeitado.

### Aprovações

- Modo `'all'` (todos precisam aprovar) ou `'any'` (qualquer aprovador decide): resolvido em `domain/approval.ts` (função pura, testada isoladamente) — `'all'` rejeita assim que alguém rejeita; `'any'` aprova assim que alguém aprova. Só o aprovador designado decide (`403 not_an_approver` caso contrário); cancelar exige `item.update`, não precisa ser o solicitante.

### Yjs/Hocuspocus adiado

- A pilha (ADR 0007) prevê Yjs para edição colaborativa; atualizações e respostas aqui são **postagens atômicas** (não documentos compartilhados de longa duração), então Tiptap sozinho + o feed sincronizado por realtime já atende. Yjs fica reservado para um campo de texto longo colaborativo futuro (ex.: descrição do item editada por várias pessoas ao mesmo tempo), se vier a existir.

### Dependências e itens relacionados: reaproveitar, não duplicar

- O Prompt 5 já tinha `GET /v1/boards/:id/dependencies` e `PUT /v1/items/:id/dependencies` (`work/presentation/board-content.controller.ts`), com detecção de ciclo no grafo inteiro do board, e o componente `DependencyEditor` no frontend. A aba "Dependências" do painel **reaproveita esse componente** em vez de recriar o fluxo (uma implementação paralela chegou a ser escrita e foi removida antes de entregar, por duplicar exatamente essa lógica).
- "Itens relacionados" (colunas `board_relation`) já aparecem e são editáveis na aba "Campos" (reaproveita `ValueEditor`/`ValueField` da Tabela) — não há uma lista separada de "relacionados" no painel.

### Frontend: entrega e navegação

- Painel como `Drawer` (`@cube-track/ui`) com URL própria via query string (`?item=<id>`) na própria rota do board — não uma rota dedicada, para manter a Tabela/Kanban por trás. Fechar remove o parâmetro; "anterior"/"próximo" navegam dentro da ordem atualmente visível na view (lista publicada por `Tabela`/`Kanban` numa store Zustand local, `item-panel-store.ts`, para não acoplar o painel à implementação de cada view).
- Presença (`rooms.item`) e todos os eventos novos (`update.*`, `reply.*`, `reaction.changed`, `attachment.changed`, `checklist.changed`, `approval.changed`) já tinham suporte genérico no gateway/fanout desde o Prompt 5 (entrega a quem está na room do board **e** a quem está na room do item); só faltava o cliente assinar a room do item, o que este prompt adiciona.
- Escopo cortado: candidatos de @menção no frontend cobrem usuários e "todos" — menção a **time** tem schema/domínio prontos no backend, mas a UI não lista times ainda (não existe tela de times no frontend); fica para quando a gestão de times for entregue.

## Consequências

- Volume pequeno de migrações (duas tabelas + duas colunas) porque a maior parte da infraestrutura (realtime por item, arquivos, permissões) já existia.
- O webhook de e-mail é a única rota pública nova do painel — precisa do segredo de servidor-a-servidor em produção (nunca o valor padrão de desenvolvimento).
- Reaproveitar `DependencyEditor` e `ValueEditor` manteve o painel consistente com a Tabela (mesmo editor, mesmo comportamento) às custas de o painel não ter uma visão dedicada de "itens relacionados" separada de "Campos".
