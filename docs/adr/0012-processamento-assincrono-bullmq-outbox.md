# ADR 0012 — Processamento assíncrono: BullMQ + outbox transacional

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto

Automações, notificações, webhooks, indexação, rollups, fórmulas, timers de SLA, importações e IA não podem ficar no caminho síncrono, mas não podem se perder (ex.: commit ok, publish falhou).

## Decisão

- Tabela **`outbox_events`** (particionada por dia) gravada na mesma transação do comando.
- _Fast path_: a API publica no Redis após o commit e marca o evento como publicado de forma assíncrona.
- **Relay** no worker (`FOR UPDATE SKIP LOCKED`) publica eventos não publicados em até 1 s e os distribui em filas **BullMQ** por finalidade (`automations`, `notifications`, `search-index`, `rollups`, `webhooks`, `imports`, `ai`, `sla-timers`), com prioridades e _rate limit_ por tenant (fairness — um tenant não monopoliza filas).
- Consumidores **idempotentes** (tabela de eventos processados por consumidor ou chaves naturais).
- Retentativas exponenciais, _dead-letter queue_ e painel (Bull Board) restrito a administradores da plataforma.
- Automações têm proteção contra loops (profundidade máxima de cadeia e detecção de ciclo por `causationId`).

## Alternativas consideradas

- **Kafka/RabbitMQ**: robustos, mas operação extra; Redis já é necessário.
- **pg-boss** (fila no PostgreSQL): simples, mas aumenta carga no banco principal.

## Consequências

- Entrega _at-least-once_; eventos carregam `eventId`, `correlationId` e `causationId`.
