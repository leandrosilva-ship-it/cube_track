# ADR 0035 — API de estrutura de navegação: árvore do workspace, favoritos, views, inbox e "Minha semana"

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 4

## Contexto

O shell precisa de:

- uma árvore de pastas e boards reorganizável;
- favoritos;
- abas de views por board;
- inbox de notificações;
- a lista "Minha semana".

Tudo isso precisa respeitar permissões (convidados só veem boards concedidos) e sincronizar em tempo real.

## Decisão

- **Novo módulo `structure`** na API (Clean Architecture), com rotas:
  - `GET /v1/workspaces/:id/tree`
  - `POST /workspaces`
  - `POST/PATCH/DELETE` de pastas
  - `POST/PATCH` de boards (criação a partir de template localizado)
  - `GET/PUT/DELETE /me/favorites`
  - `GET/POST /boards/:id/views` e `PATCH/DELETE /views/:id`
  - `GET /me/notifications`, `POST /me/notifications/read`
  - `GET /me/week`
- **Ordenação por fractional indexing** (ADR 0013). Mover recebe `afterId`/`beforeId`. Um vizinho de outro contêiner responde 400, e um ciclo de pastas responde 422. Excluir uma pasta sobe o conteúdo dela um nível.
- **Permissões:**
  - A árvore é filtrada por `can()`. Convidados veem só os boards concedidos, sem pastas.
  - A lista de workspaces inclui os que contêm boards legíveis.
  - "Minha semana" usa a coluna de pessoas e respeita bindings ocultos.
- **Eventos realtime novos:**
  - `workspace.structure_changed` (room do tenant; os clientes recarregam a árvore já filtrada pelo servidor);
  - `view.changed` (board);
  - `favorites.changed` (usuário);
  - `board.updated`.
- A view padrão não pode ser excluída. Views pessoais só são visíveis ao dono.

## Consequências

- O evento de estrutura não carrega a árvore, para não vazar nomes de boards sem permissão. O custo é um GET por cliente afetado.
