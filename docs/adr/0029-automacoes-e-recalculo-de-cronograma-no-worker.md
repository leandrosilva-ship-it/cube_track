# ADR 0029 — Automações orientadas a eventos e recálculo de cronograma no worker

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 3

## Contexto

O worker precisa processar automações e o recálculo de cronograma a partir dos eventos do outbox. As exigências são:

- reprocessamento seguro (retries e entrega pelo fast path e pelo relay);
- nenhum loop infinito entre automações;
- auditoria completa;
- propagação em tempo real das mudanças feitas pelo sistema.

## Decisão

**Automações** (`processors/automations.ts`, regras puras em `automation/rules.ts`):

- Gatilhos neste prompt: `item_created` e `column_value_changed` (com `to` e `toLabel`). Gatilhos de agenda (`date_arrives`) ficam para o Prompt 10.
- Condições: grupos `and`/`or` aninhados, usando os mesmos operadores dos filtros.
- Ações:
  - `move_to_group`;
  - `set_column_value`, por coluna ou por binding nativo, com valor dinâmico `{ relative: 'today' }` calculado no fuso do tenant;
  - `notify`.
- **Idempotência:** `automation_runs` tem índice único (automação, evento, item). Uma reentrega não executa de novo.
- **Proteção contra loops:** eventos gerados carregam `depth + 1` e `actor.kind = automation`. Eventos com `depth ≥ 3` não disparam automações.
- **Transação:** cada execução roda numa transação com contexto do tenant. Item (versão e `fieldVersions`), auditoria, atividade, outbox e o registro da execução são gravados juntos.
- **Erros:** configuração inválida grava uma execução `failed` e incrementa `error_count`, sem retry. Erros transitórios são relançados para a política de retentativas e acabam na DLQ.

**Cronograma** (`processors/schedule.ts`):

- É disparado por `item.updated` com mudança em datas planejadas ou replanejadas, ou por um job explícito de recálculo do board.
- Usa o plano vigente de cada item (replanejado, se houver; senão planejado) e grava no mesmo par de campos. O planejado original fica preservado nas baselines.
- **Empurra, não puxa:** datas só avançam. Lags são em dias úteis.
- O calendário vem do board, ou do padrão do tenant, ou de segunda a sexta. Entram feriados nacionais, estaduais (UF do calendário), municipais (IBGE) e da empresa.
- O recálculo vale só para sucessores do item alterado. Ciclos são detectados e ignorados.
- Concorrência otimista por `version`: um conflito gera retry. A fila tem concorrência 1.
- Cada item movido recebe auditoria `item.rescheduled`, atividade e evento `item.updated` (tempo real).

## Consequências

- Recalcular é idempotente: o evento gerado pelo próprio cronograma não produz novas mudanças.
- A UI de automações (Prompt 10) usa o mesmo formato JSON validado por Zod.
