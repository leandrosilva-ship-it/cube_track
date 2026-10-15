# ADR 0040 — Templates de board e privacidade na criação

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Contexto

Times precisam começar rápido (em branco, projeto, solicitações, ordens de serviço com UST) e reaproveitar boards próprios como modelo. A Galeria completa de templates e o importador de outras ferramentas chegam no Prompt 15.

## Decisão

- **Templates embutidos** declarados em `packages/shared/src/board-templates.ts`, traduzidos (pt-BR/en/es): `blank`, `project`, `requests` e `service_orders` (status, "OS emitida" Sim/Não, "Processo SEI" obrigatório quando emitida, UST, valor da UST, fórmula `ROUND({c_ust} * {c_valor_ust}, 2)` e ID automático `OS-{YYYY}-{SEQ:4}`).
- **Boards marcados como template** (`boards.is_template`) aparecem na lista; a cópia remapeia ids de grupos, colunas, rótulos e opções, copia views compartilhadas e, opcionalmente, os itens.
- `GET /v1/board-templates` lista ambos (respeitando permissão de leitura); `POST /v1/workspaces/:id/boards` aceita `template`, `icon`, descrição e visibilidade (`main`, `private`, `shareable`).
- O cabeçalho do board permite trocar o ícone e marcar/desmarcar como template (permissão `board.manage`).

## Consequências

- A criação continua em uma transação com auditoria e evento de estrutura.
- Templates embutidos evoluem com o código; templates do cliente vivem como boards comuns.
