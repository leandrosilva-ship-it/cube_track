# ADR 0041 — Ciclo de vida dos itens: arquivar, lixeira de 30 dias, mover e desfazer

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Decisão

- **Arquivar** (`archived_at`): some das views, continua consultável (`archivedOnly`) e reversível. Grupos também podem ser arquivados.
- **Excluir** (`deleted_at`): vai para a **lixeira** do board com subitens; restaurável por **30 dias** (`TRASH_RETENTION_DAYS`). O worker expurga diariamente às 03:15 (`app.purge_trash`, SECURITY DEFINER) e audita por tenant (`trash.purged`).
- **Ações em lote** por `POST /v1/boards/:id/items/actions` (`duplicate`, `archive`, `unarchive`, `delete`, `restore`, `move`, até 500 itens, atômicas) e edição em massa por `PATCH /v1/boards/:id/items`.
- **Mover entre boards** com **mapeamento de colunas** origem → destino (`suggestColumnMapping` sugere por chave/título e tipo; `remapColumnValue` converte rótulos e opções pelo texto e, entre tipos diferentes, pelo texto da célula). Subitens acompanham o pai; colunas calculadas do destino são recalculadas.
- **Duplicar** copia valores, exceto ID automático, arquivos e calculados (que são recalculados).
- **Desfazer/refazer** (Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y) no cliente: cada ação guarda as **operações inversas como chamadas à API** (valores anteriores, restaurar, desarquivar, mover de volta, excluir o que foi duplicado). Assim o desfazer passa por permissões, LWW, auditoria e chega aos outros navegadores em tempo real. Histórico de 50 ações por board; mover para outro board não é desfazível pelo atalho.

## Consequências

- Toda ação é auditada e emite eventos (`item.deleted` com `reason`, `item.created` com `reason`).
- O desfazer pode falhar se outra pessoa alterou o item (409/404); a entrada é descartada e o erro exibido.
