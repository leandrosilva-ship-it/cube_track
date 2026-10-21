# Views, Kanban e link público

Referência das views salvas de um board: tipos, configuração, governança, duplicação, link público somente leitura e filtros salvos. A fonte da verdade do contrato é `packages/shared/src/views.ts` (schemas Zod de `config`/`sort`/`groupBy`), consumida igual pela API (`apps/api/src/modules/structure/`) e pelo web.

## 1. Tipos de view

| Tipo        | Tela própria           | Config (`views.config`)              |
| ----------- | ----------------------- | ------------------------------------- |
| `table`     | sim (Prompt 5)           | `TableConfigSchema` (ordem/largura/fixação/colunas recolhidas por chave) |
| `kanban`    | sim (Prompt 6)           | `KanbanConfigSchema` (ver §2)         |
| `calendar`  | "em breve" (Prompt 8)    | genérico (`Record<string, unknown>`) |
| `timeline`  | "em breve" (Prompt 8)    | genérico                              |
| `gantt`     | "em breve" (Prompt 8)    | genérico                              |
| `form`      | "em breve" (Prompt 8)    | genérico                              |
| `map`       | "em breve" (Prompt 15+)  | genérico                              |
| `chart`     | "em breve" (Prompt 9)    | genérico                              |
| `files`     | "em breve" (Prompt 7)    | genérico                              |
| `workload`  | "em breve" (Prompt 11)   | genérico                              |
| `dashboard` | "em breve" (Prompt 9)    | genérico                              |

`IMPLEMENTED_VIEW_TYPES` (em `views.ts`) decide quais tipos ganham tela própria; os demais caem na mesma UX "módulo não habilitado" usada por Integrar/Automatizar/Agentes. Views desses tipos continuam existindo, podem ser criadas/renomeadas/reordenadas e aparecem como aba desabilitada até o prompt correspondente.

## 2. Kanban (`KanbanConfigSchema`)

```ts
{
  columnsBy: string;       // 'group' ou chave de coluna status/lista/pessoas/caixa/tags (padrão: 'group')
  swimlanesBy?: string;    // 'group' ou chave de coluna; ausente = sem raias
  cardFields: string[];    // chaves de coluna mostradas no cartão (até 12)
  cardDensity: 'compact' | 'detailed'; // padrão 'detailed'
  showCover: boolean;      // padrão false — primeiro anexo de imagem como capa
  colorBy?: string;        // chave de coluna status/dropdown/caixa usada para colorir o cartão
  wipLimits: Record<string, number>; // limite por valor da coluna de columnsBy (chave = labelId/optionId/'group:<id>')
  wipBlock: boolean;       // padrão false — true bloqueia o drop acima do limite, false só avisa
  hideEmptyColumns: boolean; // padrão false
  collapsedColumnKeys: string[]; // colunas recolhidas (lembradas por usuário? não — são da view)
}
```

- `columnsBy`/`swimlanesBy` aceitam **status, lista suspensa, pessoas, caixa de seleção ou tags**; pessoas/tags geram uma coluna por pessoa/tag (e uma "Sem atribuição"); caixa de seleção gera duas colunas (Sim/Não).
- **WIP é decisão só de interface** (ADR 0045): `wipLimits`/`wipBlock` vivem na config da própria view Kanban, não em `column_definitions` nem em nenhuma tabela — duas views Kanban do mesmo board podem ter limites diferentes, e o servidor nunca rejeita uma escrita por estourar o limite.
- Cartões mostram agregados no cabeçalho de cada coluna (contagem; soma de UST/horas quando `cardFields` inclui uma coluna numérica com essas unidades).

### Arrastar-e-soltar (ADR 0045)

| Ação                                   | Chamada à API                                                      |
| --------------------------------------- | -------------------------------------------------------------------- |
| Mover de coluna (`columnsBy`)           | `PATCH /v1/items/:id` com `values.<chave> = <novo valor>`            |
| Mover de raia (`swimlanesBy = 'group'`) | `PATCH /v1/items/:id` com `groupId`                                  |
| Reordenar na mesma coluna/raia          | `PATCH /v1/items/:id` com `afterId`/`beforeId`                       |

Não existe um endpoint "mover cartão" separado: é o mesmo `item-writer` da Tabela, então drag-and-drop já respeita permissão de coluna, obrigatoriedade condicional (abre o diálogo "Campos obrigatórios" quando falta algo) e transições de status (abaixo) sem código duplicado.

## 3. Transições de status (ADR 0046)

Coluna do tipo `status` pode ter `settings.transitions: { [rótuloOrigemId]: [rótuloDestinoId, ...] }` (até 50 destinos por origem), editável via `PATCH /v1/boards/:boardId/columns/:columnId` (campo `settings`, mesma rota do Prompt 5). Sem regra configurada para o rótulo de origem, a mudança é livre. A regra é imposta no servidor (`422 invalid_transition`) em qualquer escrita de item — Tabela, Kanban, importação — porque vive no `item-writer`, não numa tela. Ver `packages/shared/src/columns/registry.ts` (`isTransitionAllowed`).

## 4. Filtros, ordenação e agrupamento

- `filters`: a mesma AST `{ op: 'and'|'or', conditions: [...] }` do resto do produto (`FilterGroupSchema`, ADR 0005) — inclusive os tokens de data (`today`, `this_week`, `overdue`…) e `me` para colunas de pessoas.
- `sort`: lista de até 3 `{ columnKey, direction }`; `viewSortToQueryString` converte para o parâmetro `field:dir` usado pela listagem de itens.
- `groupBy`: até 3 níveis (`'group'` ou chave de coluna) — mesma convenção da Tabela.
- `hiddenColumnKeys`: colunas ocultas **desta view**, além da redação por permissão de coluna (que vale em toda superfície, inclusive link público).

## 5. Governança (ADR 0044)

- **Pessoal** (`ownerId` preenchido): só o dono lê, edita ou exclui; não entra na contagem de padrão do board.
- **Compartilhada** (`ownerId` nulo): qualquer um com `board.read` lê; editar exige `view.manage`. `isDefault`, `isLocked` e `isRestricted` só mudam com `view.manage`, mesmo que o usuário já pudesse editar a view por outro motivo.
- No máximo **uma view padrão** por dono (pessoal) ou por board (compartilhada) — marcar uma nova padrão desmarca a anterior do mesmo escopo, na mesma transação.
- A view padrão **não pode ser excluída** (`400`).
- `isRestricted`: view compartilhada visível só a quem tem concessão explícita ou gerencia o board (além de `board.read`).

### Duplicar

`POST /v1/views/:id/duplicate` copia tipo, `config`, `filters`, `sort`, `groupBy` e `hiddenColumnKeys` para uma view nova e **independente** — editar a cópia nunca muda a original. Nasce não padrão, não bloqueada e não restrita; `personal` pode ser escolhido na duplicação (padrão: mesma visibilidade da origem).

## 6. Link público (ADR 0047)

Link somente leitura de uma **view específica** (não do board inteiro), com senha e expiração opcionais. Gerenciar exige `board.share` no board da view.

### Gerenciamento (autenticado)

| Rota                              | Corpo / resposta                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /v1/views/:id/share-link`     | status: existe, exige senha, expiração, revogado, contagem e data do último acesso, colunas ocultas, busca |
| `PUT /v1/views/:id/share-link`     | cria ou atualiza: `password` (`null` remove), `expiresAt` (`null` remove), `hiddenColumnKeys`, `allowSearch`, `regenerateToken`. **O token em claro só volta na resposta quando `regenerateToken: true`** (ou na primeira criação) — não é recuperável depois, como os links de convite |
| `DELETE /v1/views/:id/share-link`  | revoga (mantém `access_count`/`last_accessed_at` para auditoria, não apaga a linha)                     |

### Acesso público (sem autenticação)

1. `GET /v1/public/share/:token/info` → `{ requiresPassword }`, sem criar sessão.
2. `POST /v1/public/share/:token/verify` → `{ password? }`; devolve `{ shareToken, boardId, viewId, expiresInSeconds }`. `shareToken` é um JWT próprio (`typ: share+jwt`, 1h) — não confundir com o token do link nem com o access token da conta.
3. `GET /v1/public/share/board` e `GET /v1/public/share/items` exigem o cabeçalho **`X-Share-Session: <shareToken>`** (nunca `Authorization`, para não colidir com o guard de login).

Qualquer falha (token inexistente, revogado, expirado, senha errada) responde `401 share_link_invalid` — sem distinguir os casos, para não permitir enumerar links por tentativa e erro.

### Redação e limites (escopo desta entrega)

- Colunas ocultas: união de `views.hiddenColumnKeys` com `share_links.settings.hiddenColumnKeys` — o link só pode esconder **mais** colunas do que a view já esconde.
- Itens: só de topo (sem subitens), até **1.000**, ordenados por `(group_id, position)`, sem paginação. `allowSearch` filtra por nome (`?q=`) quando habilitado.
- **Filtros, ordenação e agrupamento da própria view não são aplicados na leitura pública** nesta entrega — fica para quando uma tela pública de Tabela/Kanban precisar deles de verdade. A API devolve o board (grupos e colunas) e os itens; montar a mesma visualização da view é trabalho futuro do front-end público.
- Sem tela pública no `apps/web` ainda (só a API) — entra quando o link for exposto na UI de gerenciamento de views.

## 7. Filtros salvos

`saved_filters` (pessoal ou compartilhado) reutiliza a mesma AST de `filters`. `GET/POST /v1/boards/:boardId/saved-filters` (pessoal exige `board.read`, compartilhado exige `view.manage`); `DELETE /v1/saved-filters/:id` exige ser o dono ou `view.manage`. Não aparecem como view — são atalhos de filtro reutilizáveis entre views do mesmo board (ex.: o mesmo filtro "Sem replanejamento" usado na Tabela e no Kanban).

## 8. Permissões

Tabela completa em `docs/permissions.md` ("Views, link público e filtros salvos").
