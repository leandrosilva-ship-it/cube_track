# Runbook — fila do BullMQ com atraso crescente (worker não acompanha)

## Sintomas

- Usuários reportam demora para receber e-mail de notificação, automação não disparou, busca
  (Meilisearch) desatualizada, ou sincronização de calendário atrasada.
- Bull Board (`http://<worker>:3010/admin/queues`, autenticado com `BULL_BOARD_USER`/
  `BULL_BOARD_PASSWORD`) mostra uma fila com `waiting` crescendo continuamente.
- Alerta `CubeTrackQueueBacklogGrowing` (ver `infra/observability/prometheus/alerts.yml`).

Filas existentes (`packages/shared/src/jobs.ts`, `QUEUES`) e o que cada uma atrasar significa:

| Fila | Atraso visível como |
| --- | --- |
| `emails` | e-mails (magic link, convite, digest) chegando atrasados |
| `notifications` | notificações in-app atrasadas |
| `automations` | automações/processos (Pipefy-like) não disparando a tempo |
| `schedule` | recálculo de cronograma/caminho crítico desatualizado (ADR 0029) |
| `search-index` | busca (Meilisearch) retornando itens desatualizados ou ausentes |
| `file-scan` | upload de arquivo preso em "verificando" (antivírus) |
| `computed` | colunas calculadas/rollups desatualizados |
| `portfolio` | rollup de portfólio/programa desatualizado |
| `maintenance` | tarefas de manutenção (retenção do outbox etc.) atrasadas |
| `webhooks` / `webhook-deliveries` | automações com ação de webhook não entregues |
| `ai-agents` | agentes de IA não respondendo a gatilhos |
| `imports` | importação de planilha/CSV parada |
| `calendar-sync` | sincronização Google/Microsoft Calendar atrasada |
| `dead-letter` | jobs que esgotaram as 5 tentativas (`DEFAULT_JOB_OPTIONS`) — ver passo 4 |

Atraso no **outbox relay** especificamente (não é bem uma fila BullMQ, mas o mesmo sintoma de
"atraso crescente") aparece como eventos de tempo real atrasados entre dois navegadores — ver
`OUTBOX_POLL_MS`/`OUTBOX_BATCH_SIZE` abaixo também.

## Diagnóstico

1. **Qual fila, e o tamanho real do atraso:**
   - Bull Board mostra `waiting`/`active`/`delayed` por fila em tempo real.
   - Ou via Redis direto: `redis-cli -u $REDIS_URL llen bull:<fila>:wait`.

2. **O worker está processando, só devagar, ou travado?**
   ```bash
   kubectl -n cube-track top pod -l app.kubernetes.io/component=worker
   kubectl -n cube-track logs -l app.kubernetes.io/component=worker --tail=100 | grep -i "error\|failed"
   ```
   CPU/memória no limite → sub-dimensionado para a carga atual (ver Remediação). Logs com erros
   repetidos do mesmo tipo de job → é falha sistemática (ex.: uma integração externa fora do ar),
   não falta de capacidade — aumentar réplicas não ajuda, tratar a causa.

3. **`WORKER_CONCURRENCY` está adequado?** (`.env.example`, padrão 8 jobs simultâneos por
   processo). Jobs de I/O-bound (chamada a API externa, envio de e-mail) toleram concorrência
   maior que jobs de CPU-bound (recálculo de cronograma).

4. **Fila `dead-letter` crescendo:** jobs que já esgotaram as 5 tentativas
   (`DEFAULT_JOB_OPTIONS.attempts`) caem aqui — inspecione no Bull Board o `failedReason` de
   alguns; se for o mesmo erro repetido, é uma causa sistemática (ex.: credencial de integração
   expirada) que vai continuar gerando dead-letters até ser corrigida na origem.

5. **Outbox relay atrasado** (eventos de tempo real, não uma fila BullMQ): verifique
   `OUTBOX_POLL_MS`/`OUTBOX_BATCH_SIZE` no worker e o tamanho da tabela de outbox:
   ```sql
   select count(*) from outbox_events where processed_at is null;
   ```
   Crescendo sem parar → o worker não está rodando, ou o relay está caindo com erro (ver logs do
   worker filtrando por "outbox").

## Remediação

- **Capacidade insuficiente (CPU/memória no limite, sem erros sistemáticos nos logs):**
  ```bash
  kubectl -n cube-track scale deployment/cube-track-worker --replicas=<N+1>
  ```
  ou suba `worker.resources.limits` no overlay do ambiente e `helm upgrade`. BullMQ distribui
  jobs entre todos os workers conectados ao mesmo Redis automaticamente — não precisa de
  configuração extra para escalar horizontalmente.
- **Causa sistemática (mesma falha repetida):** pausar a fila afetada no Bull Board para parar de
  queimar tentativas enquanto a causa raiz é corrigida (ex.: credencial de integração, endpoint
  externo fora do ar), depois retomar.
- **Dead-letter com jobs recuperáveis:** depois de corrigir a causa raiz, jobs específicos podem
  ser reenfileirados manualmente pelo Bull Board ("retry" no job).
- **Outbox relay travado:** reiniciar o pod do worker
  (`kubectl -n cube-track rollout restart deployment/cube-track-worker`) — o relay retoma do
  último evento não processado, idempotente por `eventId` (ADR 0027).

## Prevenção

- Alerta de backlog (`CubeTrackQueueBacklogGrowing`) com limiar calibrado por fila — `emails`
  tolera minutos de atraso, `schedule`/`computed` idealmente não.
- `worker.autoscaling` por CPU está desligado por padrão no chart (ver
  `infra/helm/cube-track/README.md` "Autoscaling") porque CPU é um sinal fraco de backlog de
  fila — o indicador real é `waiting` por fila, que exige KEDA com o scaler `redis` apontando
  para `bull:<fila>:wait` para autoescalar de verdade; até lá, o ajuste de réplicas é manual.
