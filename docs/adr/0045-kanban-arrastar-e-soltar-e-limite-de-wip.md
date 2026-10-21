# ADR 0045 — Kanban: arrastar-e-soltar reaproveita a escrita do item; WIP é só no cliente

- **Status:** Aceita
- **Data:** 2026-10-16
- **Prompt:** 6

## Contexto

O Kanban precisa agrupar cartões em colunas por um campo (status, lista, pessoas, tags) e, opcionalmente, em raias por outro campo (geralmente o grupo). Arrastar um cartão para outra coluna/raia muda dado de verdade (não é só um estado de UI) e precisa: respeitar permissões de edição de coluna, obrigatoriedade condicional (ADR 0039) e, quando configurado, transições de status (ADR 0046) — sem duplicar essa lógica entre Tabela e Kanban.

## Decisão

- **Nenhuma tabela nova.** O Kanban reaproveita `items.position` (já com escopo por `board_id` + `group_id`) e o mesmo endpoint de escrita de item (`PATCH /v1/items/:id`) que a Tabela já usa.
- **Mover de coluna** (agrupamento por campo) = `PATCH` do valor da coluna usada em `columnsBy` (ex.: `values.c_status`). Isso já passa pelo `item-writer` existente, então ganha de graça: permissão de edição da coluna, obrigatoriedade condicional (abre o diálogo "Campos obrigatórios" se faltar algo) e a transição de status do ADR 0046 (bloqueia e mostra o motivo se a mudança não for permitida).
- **Mover de raia** (quando `swimlanesBy = 'group'`) = `PATCH groupId`, reaproveitando a mesma validação de "grupo pertence ao board" que a Tabela já tem.
- **Reordenar dentro da mesma coluna/raia** = `PATCH` com `afterId`/`beforeId`, válido só quando os dois cartões compartilham o grupo de destino (mesma regra de posicionamento fracionário do resto do produto).
- Um drag que muda coluna **e** raia ao mesmo tempo vira duas mudanças no mesmo `PATCH` (`groupId` + o campo de `columnsBy`).
- **Limite de WIP é só no cliente**: guarda de UX (aviso visual e, se configurado, bloqueio do drop) guardada em `views.config.kanban.wipLimits`/`wipBlock` — não há imposição no servidor. Dois Kanbans diferentes do mesmo board podem ter limites diferentes (ou nenhum) sem conflito, porque o limite não é uma regra de dado, é uma preferência de visualização.

## Consequências

- Nenhum caso de uso novo no backend para "mover cartão" — o mesmo `PATCH /v1/items/:id` atende Tabela e Kanban, então uma mudança de regra de negócio (ex.: uma nova condição obrigatória) vale para os dois sem trabalho extra.
- Arrastar um cartão para uma coluna que violaria uma transição de status mostra o erro do servidor (ou é bloqueado antes, se o cliente já souber a regra); arrastar para uma coluna que deixaria um campo obrigatório vazio abre o mesmo diálogo que a Tabela usa.
- Como o WIP não é imposto no servidor, importar itens em massa ou editá-los pela Tabela pode deixar uma coluna do Kanban acima do limite — o Kanban mostra isso (contador vermelho), não corrige sozinho.
