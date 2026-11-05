# Testes de carga (k6) — Prompt 16

Dois cenários k6 validam os critérios de desempenho do `CLAUDE.md` §2 contra o board de carga
semeado por `pnpm db:seed:large` ("Carga — 50 mil itens"):

- **`items-list.js`** — `GET /v1/boards/:boardId/items` (paginação por cursor, filtro e ordenação
  reais), rampa de 0 a `LOAD_VUS_MAX` VUs. Critério: **p95 < 200 ms**.
- **`realtime.js`** — um grupo de VUs mantém uma conexão Socket.IO inscrita no board enquanto outro
  grupo muda itens via REST; mede o tempo entre a ocorrência do evento e o recebimento pelo socket.
  Critério: **p95 < 300 ms**. Cruza o número medido no cliente com o histograma Prometheus real
  `cube_realtime_propagation_ms` (`scrape-metrics.sh`).

## Pré-requisitos

- k6 instalado (`k6 version`) — não é dependência do monorepo (binário Go, não npm). Baixe em
  <https://k6.io> ou `https://github.com/grafana/k6/releases`.
- Stack local no ar com o board de carga semeado:
  ```bash
  pnpm infra:up   # Postgres, Redis, Meilisearch, Mailpit (MinIO se precisar de arquivos)
  pnpm db:migrate && pnpm db:seed && pnpm db:seed:large
  pnpm build
  pnpm --filter @cube-track/api start      # API :3001 — ative métricas Prometheus (ver abaixo)
  pnpm --filter @cube-track/worker start   # worker (outbox relay necessário para o cenário realtime)
  ```
- **Métricas Prometheus**: o `.env` de dev desativa o OpenTelemetry por padrão
  (`OTEL_SDK_DISABLED=true`). Para cruzar com `cube_realtime_propagation_ms`, suba a API com
  `OTEL_SDK_DISABLED=false` (exporta em `:9464/metrics`, configurável por `METRICS_PORT`).
- **Limite de requisições por usuário**: os dois scripts autenticam via tokens de API pessoais
  (`apps/api/src/modules/api-access`, ADR 0056) — um token por VU, nunca um único token
  compartilhado (cada token tem teto de 300 req/min, `API_TOKEN_RATE_LIMIT`). Mas todos os tokens
  pertencem ao MESMO usuário de demonstração, e o teto padrão por usuário
  (`RATE_LIMIT_PER_MINUTE`, 600/min) ainda se aplica por cima disso. Para uma rampa de centenas de
  VUs, suba-o só para a duração do teste:
  ```bash
  RATE_LIMIT_PER_MINUTE=1000000 OTEL_SDK_DISABLED=false pnpm --filter @cube-track/api start
  ```
  Em produção, 1000 usuários reais têm 1000 contas distintas e nunca colidem nesse teto — isto é
  um ajuste do ambiente de teste, não do padrão de produção.

## Rodando

```bash
pnpm load:items                              # pnpm run load:items (requer k6 no PATH)
pnpm load:realtime

# Ajustando a carga:
LOAD_VUS_MAX=1000 LOAD_RAMP_UP=1m LOAD_HOLD=2m pnpm load:items
LOAD_SUBSCRIBERS=50 LOAD_MUTATORS=10 LOAD_DURATION=1m pnpm load:realtime

# Cruzando com a métrica real do servidor (rodar durante/logo após o cenário realtime):
OTEL_SDK_DISABLED=false tools/load/scrape-metrics.sh
```

Cada script escreve um resumo em `tools/load/results/*.json` (git-ignorado) e imprime pass/fail no
stdout; o processo sai com código 1 se o threshold de p95 for violado (os dois scripts definem
`thresholds` nativos do k6 — a falha do limiar já encerra com `exit 1`, sem lógica própria).

## Resultados medidos nesta sessão (sandbox de 4 vCPU / 16 GB, Postgres/Redis/Meilisearch em Docker)

### `items-list.js`

| VUs de pico | p50       | p95        | max        | `http_req_failed` |
| ----------- | --------- | ---------- | ---------- | ------------------ |
| 1 (sequencial, sem concorrência) | — | 150–400 ms¹ | — | 0% |
| 50          | 2 938 ms  | 4 317 ms   | 4 791 ms   | 0%                  |
| 300         | 17 365 ms | 22 260 ms  | 23 888 ms  | 0%                  |

¹ Varia por tipo de consulta: sem ordenação (`limit=50`, caminho padrão por posição) fica em
150–200 ms; ordenar por coluna nativa (`name`) ou customizada (`c_ust`, `c_prazo`) sobe para
250–400 ms **mesmo sem nenhuma concorrência** — ver causa raiz abaixo.

**Resultado: FALHOU o critério de p95 < 200 ms**, e piora com a concorrência em vez de estabilizar —
não é um limite de taxa nem um artefato de autenticação (ambos foram isolados e corrigidos: um
token por VU, teto por usuário elevado só para o teste). Duas causas raiz confirmadas com
`EXPLAIN (ANALYZE, BUFFERS)` direto no Postgres do board de 50 mil itens:

1. **Ordenar/filtrar por qualquer coluna customizada faz table scan.** `item-query.ts` junta
   `items` a `item_field_index` com `LEFT JOIN ... ON item_id = i.id AND column_key = :key`. O
   índice composto que existiria para exatamente esse padrão
   (`item_field_index_num_idx (board_id, column_key, v_num, item_id)`, e os irmãos
   `_date_idx`/`_text_idx`/`_bool_idx`) **não pode ser usado para o `ORDER BY ... LIMIT`** porque o
   `LEFT JOIN` obriga o Postgres a preservar itens sem valor na coluna (ordenados por último) — ele
   não consegue provar, sem materializar o lado esquerdo inteiro, que os 50 primeiros por valor não
   incluem um item "sem linha" em `item_field_index`. Resultado: `Parallel Hash Right Join` sobre
   dois `Seq Scan`s, ~85–95 ms de execução no banco **só para ler 50 linhas de um board com 50 mil**.
   Em um board pequeno (ex. "PMSP", ~60 itens) o planner escolhe um `Nested Loop` e o mesmo padrão
   custa <1 ms — o problema só aparece na escala que este Prompt testa.
2. **Mesmo o caminho padrão (sem ordenação) e a ordenação por coluna nativa (`name`) fazem
   `Seq Scan`/`Parallel Seq Scan` de todo o board** quando o board tem 50 mil itens — não há índice
   cobrindo `(board_id, lower(name))`, e mesmo a leitura "sem filtro" é dominada pelo custo de ler
   e filtrar ~50 mil linhas (ainda que mais barato, ~30–200 ms, que o caso de coluna customizada).

Sob concorrência, cada consulta cara dispara **parallel workers** do Postgres — em 50 VUs
simultâneas a carga média do sandbox chegou a 8,94 (4 vCPUs, ~95% de CPU em uso, a maior parte em
processos `postgres`), explicando por que o p95 piora de forma super-linear com o número de VUs em
vez de simplesmente reproduzir o custo de uma única consulta.

**Diagnóstico completo (causa raiz, comandos `EXPLAIN` usados e um caminho de correção avaliado e
descartado por risco) registrado para uma correção dedicada** — ver "Pendências" abaixo; não foi
corrigido nesta sessão porque exigiria reescrever a estratégia de paginação/ordenação do motor de
consulta de itens (arquivo de 655 linhas, usado por Tabela, Kanban, dashboards e exportação) com
testes novos, o que é maior que um ajuste pontual de performance seguro de se improvisar.

### `realtime.js`

O protocolo (Engine.IO/Socket.IO v4 direto sobre `k6/ws`, sem biblioteca cliente) foi implementado e
**validado ponta a ponta no handshake**: conexão WS, pacote `open`, `CONNECT` autenticado com o
access token no payload (`auth.token`), recebimento do evento `ready`. A chamada de inscrição na
room do board (`subscribe`, `{room: 'board', id: boardId}`) retorna hoje `{"ok":false,"error":
{"code":"internal_error"}}` — isolado e confirmado como um bug **não relacionado a este prompt**, em
código de permissões sob desenvolvimento concorrente (outro agente, ADR 0057 — visibilidade de item
por "órgão" para convidados): `AccessService.can(user, 'board.read', {type:'board', ...})` falha,
enquanto `AccessService.assert`/`AccessService.board()` (usados por `GET /v1/boards/:id` e
`GET /v1/boards/:id/items`, que o cenário `items-list.js` exercita sem problema) funcionam
normalmente — o defeito está isolado ao dispatcher `can()` → `decide()`
(`packages/shared/src/permissions.ts`), fora do escopo deste trabalho de performance e explicitamente
fora dos arquivos que esta entrega deveria tocar.

**Não foi possível coletar números reais de propagação nesta sessão** por essa dependência externa.
O script está pronto: assim que o `subscribe` voltar a funcionar, `pnpm load:realtime` mede o p95 do
lado do cliente e `scrape-metrics.sh` lê o p95 real do histograma `cube_realtime_propagation_ms` do
lado do servidor para a validação cruzada pedida.

## Pendências (fora do escopo desta sessão, documentadas para follow-up)

- **Índice não aproveitado em `item-query.ts`** para ordenar/filtrar por coluna customizada em
  boards grandes (causa raiz nº 1 acima) — precisa de uma estratégia de topo-N (ex.: consulta em
  duas etapas aproveitando `item_field_index_num_idx`/`_date_idx`/`_text_idx`, com UNION para itens
  sem valor na coluna quando o resultado da primeira etapa tiver menos que `limit` linhas) que
  preserve a paginação por cursor e os filtros combinados existentes. Não é um índice novo — os
  índices já existem; é a forma da consulta que impede o planner de usá-los.
- **Ordenação padrão (sem coluna customizada) em boards de 50 mil itens** também faz
  `Seq Scan`/`Parallel Seq Scan` — avaliar um índice `(board_id, lower(name), id)` ou equivalente
  para o caminho "ordenar por nome", e confirmar se o caminho sem ordenação (por posição) já usa o
  índice de posição esperado sob este volume.
- **`AccessService.can()` → `decide()` para `board.read` retorna `internal_error`** no gateway
  realtime (`realtime.gateway.ts`, método `subscribe`) — bug isolado durante este trabalho, mas em
  código de outro prompt concorrente; repassado para quem está mexendo em
  `packages/shared/src/permissions.ts`/`apps/api/src/modules/access` nesta janela.
