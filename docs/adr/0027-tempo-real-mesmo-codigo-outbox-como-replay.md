# ADR 0027 — Tempo real no mesmo código da API; outbox como log de replay

- **Status:** Aceita (refina a ADR 0007)
- **Data:** 2026-10-14
- **Prompt:** 3

## Contexto

A ADR 0007 previa o gateway em `apps/realtime`. Ao implementar, vimos que o gateway precisa das mesmas regras da API para autorizar, redigir eventos por destinatário e fazer replay. Duplicar essas regras em outro pacote causaria divergência de permissões entre REST e WebSocket, o que fere um critério de aceite.

## Decisão

- O gateway Socket.IO fica em `apps/api/src/modules/realtime` e reutiliza `AccessService` e `ItemsService`. São dois modos de execução:
  - `REALTIME_MODE=embedded`: um processo atende API e WS (desenvolvimento e instalações pequenas);
  - `REALTIME_MODE=separate`: a API não sobe o gateway e o entrypoint `main.realtime` roda em um deployment próprio, escalado à parte. Isso mantém o isolamento operacional previsto na ADR 0007.
- **Comandos só via REST.** O WebSocket serve apenas para assinatura, presença e renovação de token.
- **Outbox como log de replay:**
  - Cada evento de board recebe `seq` contíguo (`boards.seq`) na mesma transação da escrita.
  - O outbox guarda os eventos por `OUTBOX_RETENTION_DAYS`.
  - A reconexão faz replay a partir de `lastSeq` (até 500 eventos; acima disso, `resyncRequired`).
- **Entrega em dois caminhos:**
  - _fast path_: após o commit, a API publica no canal Redis `cube:realtime:events`;
  - _garantia_: o `OutboxRelay` do worker republica o que ainda não foi marcado e despacha às filas.
  - Os nós deduplicam por `eventId`.
- **Redação por destinatário** em cada nó: colunas ocultas e escopo do convidado. Os metadados `routing` (responsáveis, colunas afetadas) nunca saem do servidor.

## Alternativas consideradas

- **Pacote `apps/realtime` separado:** duplicaria regras de permissão ou exigiria uma chamada RPC por evento e destinatário.
- **Apenas fast path, sem relay:** um evento se perderia se a API caísse entre o commit e a publicação.
- **Apenas relay (polling):** a latência subiria para a ordem do intervalo de polling.

## Consequências

- O p95 medido em teste automatizado foi de cerca de 64 ms, abaixo da meta de 300 ms.
- O cliente precisa deduplicar por `eventId` e tratar `sequence.skipped`.
- `docs/realtime-events.md` é o contrato público.
