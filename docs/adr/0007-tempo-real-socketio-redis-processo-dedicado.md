# ADR 0007 — Tempo real: Socket.IO + Redis adapter em processo dedicado (`apps/realtime`)

- **Status:** Refinada pela [ADR 0027](0027-tempo-real-mesmo-codigo-outbox-como-replay.md) (mesmo código da API, deployment separado)
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto

Meta de propagação p95 < 300 ms entre navegadores, presença, milhares de conexões simultâneas, múltiplas réplicas e deploys frequentes da API.

## Decisão

- **Socket.IO** (WebSocket + fallback) com **`@socket.io/redis-adapter`** para fan-out entre réplicas; _sharded pub/sub_ do Redis 7 quando necessário.
- Processo **dedicado `apps/realtime`** (mudança justificada em relação à stack sugerida): escala por conexões, isolado de deploys da API, HPA por número de conexões.
- **Comandos entram via REST na API** (validação, auditoria, rate limit e idempotência em um só caminho); o socket é usado para **eventos servidor → cliente**, subscribe/unsubscribe, presença e awareness.
- Rooms: `t:`, `u:`, `ws:`, `b:`, `i:`, `d:` (ver `architecture.md` §2.2), com autorização no subscribe e filtro de payload por permissão (colunas ocultas) no fan-out.
- Publicação: _fast path_ pela API logo após o commit + relay do outbox pelo worker (garantia). Deduplicação por `eventId`.
- Sequência monotônica por board (`seq`), **Redis Stream por board** para replay de lacunas, `resync_required` quando a lacuna não puder ser coberta.
- Presença em Redis com TTL (não persistida).

## Alternativas consideradas

- **WebSocket puro (`ws`) ou uWebSockets**: mais leve, mas teríamos de reimplementar rooms, reconexão, acks e adapter multi-nó.
- **Serviços gerenciados (Ably, Pusher, Liveblocks)**: rápidos de adotar, porém custo por conexão/mensagem, dados fora do Brasil e dependência de fornecedor.
- **PostgreSQL LISTEN/NOTIFY** como barramento: limite de payload (8 kB), não escala para muitas réplicas.
- **Comandos pelo socket**: duplica caminho de validação/auditoria e dificulta a API pública.

## Consequências

- LB com suporte a WebSocket e sticky sessions apenas para polling.
- Testes E2E com dois navegadores e testes de carga (k6) de propagação são parte da DoD.
