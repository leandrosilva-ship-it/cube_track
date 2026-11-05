# Deploy — CUBE TRACK

Guia de referência para build, deploy, migrações, feature flags, backup/restauração e resposta a
incidentes. Lê-se junto com `infra/helm/cube-track/README.md` (detalhes do chart) e
`docs/runbooks/` (procedimentos de incidente).

**Honestidade sobre o que é real hoje:** este repositório tem Dockerfiles, chart Helm, scripts de
backup/restauração e pipelines de CI que **rodam de verdade** neste ambiente (testados com
builds reais do Docker e `helm lint`/`helm template`). O que **não** roda de verdade aqui, por
falta da infraestrutura externa correspondente, está listado explicitamente na seção "Lacunas
reais" no fim deste documento — nunca tratado como pronto quando não está.

## 1. Ambientes

| Ambiente | Onde roda | Datastores | Como se atualiza |
| --- | --- | --- | --- |
| **dev** | `docker-compose.yml` na raiz (padrão do dia a dia) OU um cluster k8s local (kind/minikube/k3d) com `values-dev.yaml` | Em containers locais (Postgres/Redis/MinIO/Meilisearch/Mailpit) | `pnpm infra:up` + `pnpm --filter ... dev` (hot reload) — o chart Helm em modo dev é só para validar os manifests, não o fluxo do dia a dia |
| **staging** | Kubernetes (`values-staging.yaml`) | Gerenciados externos (RDS/Cloud SQL, ElastiCache/Memorystore, bucket S3, Meilisearch dedicado) | `helm upgrade` via `.github/workflows/deploy.yml` (manual, `workflow_dispatch`) |
| **production** | Kubernetes (`values-production.yaml`) | Gerenciados externos, instâncias próprias de produção | Igual a staging, com `environment: production` do GitHub exigindo aprovação (se configurado) |

PostgreSQL/Redis/S3/Meilisearch **nunca** são implantados como pods deste chart em
staging/produção — são serviços gerenciados. `values-dev.yaml` é a única exceção pensada para
apontar a datastores em containers, e mesmo assim só se alguém realmente quiser rodar a stack
inteira dentro de um cluster local.

## 2. Build e push de imagens

Três imagens de aplicação + duas de suporte, todas multi-stage, usuário não-root, sem pacotes de
sistema desnecessários:

| Imagem | Dockerfile | O que é |
| --- | --- | --- |
| `cube-track-api` | `apps/api/Dockerfile` | REST + GraphQL + gateway realtime (embedded ou `main.realtime.js` separado, ADR 0027) |
| `cube-track-worker` | `apps/worker/Dockerfile` | BullMQ (outbox relay, e-mails, automações, cronograma, busca, antivírus) + Bull Board |
| `cube-track-web` | `apps/web/Dockerfile` | Next.js, `output: 'standalone'` |
| `cube-track-db-migrate` | `packages/db/Dockerfile` | Só para o Job de migração do Helm chart — `packages/db` não tem build próprio, roda via `tsx` |
| `cube-track-backup` | `infra/docker/backup/Dockerfile` | `pg_dump` + `mc` (MinIO client), para o CronJob de backup |

Build local (a partir da raiz do monorepo):

```bash
docker build -f apps/api/Dockerfile -t cube-track-api:local .
docker build -f apps/worker/Dockerfile -t cube-track-worker:local .
docker build -f apps/web/Dockerfile -t cube-track-web:local .
docker build -f packages/db/Dockerfile -t cube-track-db-migrate:local .
docker build -f infra/docker/backup/Dockerfile -t cube-track-backup:local .
```

**Registro: GHCR (`ghcr.io`).** Escolhido porque usa o `GITHUB_TOKEN` padrão do Actions — sem
criar conta nova nem cadastrar segredo adicional — e já funciona neste repositório hoje.
`.github/workflows/build-and-push.yml` builda e publica as 5 imagens em todo push para `main` e
toda tag `v*.*.*`, com cache do GitHub Actions (`cache-from`/`cache-to: type=gha`).

Padrão de dependências pnpm nos Dockerfiles: um install completo (`pnpm install
--frozen-lockfile`) para o estágio de build (o `tsup` dos pacotes internos `@cube-track/db` e
`@cube-track/shared` são consumidos como fonte, via `noExternal` no `tsup.config.ts` — não
precisam de build próprio), e um install **filtrado e travado no lockfile** só com as
dependências de produção (`pnpm install --frozen-lockfile --prod --filter
"@cube-track/<app>..."`) para a imagem final — deliberadamente não usamos `pnpm deploy` (modo
`--legacy`, necessário nesta versão do pnpm para um workspace com lockfile compartilhado,
reresolve o workspace inteiro — inclusive pacotes não relacionados — e isso se mostrou mais lento
e frágil que um install filtrado comum).

## 3. Instalar / atualizar via Helm

Ver `infra/helm/cube-track/README.md` para a referência completa (estrutura do chart, secrets
esperados, autoscaling, gateway realtime separado). Resumo:

```bash
helm upgrade --install cube-track infra/helm/cube-track \
  -f infra/helm/cube-track/values-staging.yaml \
  --namespace cube-track-staging --create-namespace \
  --set image.tag=<git-sha-ou-tag>
```

## 4. Migrações seguras (zero downtime)

Um `Job` (`infra/helm/cube-track/templates/migration-job.yaml`) roda como hook Helm
`pre-install,pre-upgrade`: `pnpm --filter @cube-track/db db:migrate` precisa terminar com sucesso
**antes** do Helm tocar nos Deployments de api/worker/web. Se falhar, o release é abortado e a
versão anterior continua no ar sem interrupção.

A contrapartida é uma regra de processo para quem escreve migrações e código de aplicação —
**regra de migração aditiva-primeiro**, detalhada com exemplos em
`docs/runbooks/migracao-falhou.md`:

1. Coluna/tabela nova entra nullable/com default, numa migração própria, **antes** de qualquer
   código passar a usá-la.
2. O deploy do código que usa a coluna nova vem depois (a migração já é no-op, idempotente).
3. Remover (ou endurecer) só depois que nenhum pod da versão anterior ainda lê/escreve naquilo.

Pular essa ordem é a causa mais comum de um rollout quebrar pods antigos e novos ao mesmo tempo —
ver o runbook para o procedimento de diagnóstico e correção quando isso já aconteceu.

## 5. Feature flags via deploy

**O que existe hoje:** um mecanismo de infraestrutura — qualquer chave em `values.config` (ou nos
overlays `values-staging.yaml`/`values-production.yaml`) vira variável de ambiente nos três
serviços via `ConfigMap` (`infra/helm/cube-track/templates/configmap.yaml`). Uma flag nova é uma
chave nova, com um valor diferente por ambiente, sem precisar de admin UI nem de uma tabela no
banco. Ativar/desativar exige um novo `helm upgrade` — não é um toggle em tempo real.

**O que isso NÃO é:** não existe hoje nenhuma funcionalidade do produto que efetivamente leia uma
dessas variáveis para se comportar diferente (nenhum `process.env.FEATURE_X` no código de
`apps/api`/`apps/worker`/`apps/web` neste momento) — é a convenção/mecanismo pronto para a
próxima feature que precisar disso, documentada para quem for usá-la, não uma flag já em uso. Uma
tabela `feature_flags` com toggle em runtime (sem redeploy) seria uma mudança de schema/aplicação,
fora do escopo deste prompt (que é a camada de deploy/infra) — ver CLAUDE.md para o dono de cada
bounded context.

## 6. Backup e restauração

- **Backup:** `infra/scripts/backup-postgres.sh` (`pg_dump --format=custom` + upload via `mc` para
  o bucket S3-compatível configurado pelas mesmas variáveis `S3_*` do `.env.example`), rodado
  diariamente pelo `CronJob` `infra/helm/cube-track/templates/backup-cronjob.yaml`
  (`backup.schedule`, padrão `0 7 * * *` UTC). Retenção configurável
  (`BACKUP_RETENTION_DAYS`/`backup.retentionDays`, padrão 30 dias em staging, 90 em produção).
- **Teste de restauração:** `infra/scripts/test-restore.sh` gera (ou baixa de `--from-s3`) um
  dump, restaura num Postgres **descartável** (container Docker, destruído ao final) e confirma
  que (1) `pg_restore` termina sem erro e (2) `pnpm --filter @cube-track/db db:migrate` não
  encontra nenhuma migração pendente contra o banco restaurado — ou seja, o backup não é só
  "restaurável", está no **schema atual**. Rodado semanalmente por
  `.github/workflows/backup-restore-test.yml` (`workflow_dispatch` + `schedule` semanal).
- Procedimento de restauração real (não o teste): restaurar o dump mais recente num banco novo
  (gerenciado), apontar `DATABASE_*_URL` para ele, confirmar com o mesmo `test-restore.sh` antes
  de promover. Nunca restaurar por cima do banco de produção sem antes validar num ambiente
  separado.

## 7. Observabilidade

- **Métricas:** os três serviços já expõem OpenTelemetry/Prometheus em `METRICS_PORT` (padrão
  9464) — nada disso foi adicionado por este prompt, já estava implementado
  (`apps/api/src/instrumentation.ts`, `apps/worker/src/instrumentation.ts`,
  `apps/api/src/core/observability/metrics.ts`).
- **Nomes de métrica confirmados rodando de verdade** (não adivinhados): subimos a api localmente
  (`pnpm --filter @cube-track/api build && METRICS_PORT=9464 OTEL_SDK_DISABLED=false node
  --import ./apps/api/dist/instrumentation.js apps/api/dist/main.js`), fizemos algumas
  requisições (`/health/live`, `/health/ready`, `/v1/docs`, uma 404) e lemos
  `curl localhost:9464/metrics`. O que veio:
  - `http_server_duration_count` / `_sum` / `_bucket` — histograma em **milissegundos** (não
    segundos), labels `http_method`, `http_status_code`, `net_host_port`, etc. Essa é a
    convenção usada por esta versão do `@opentelemetry/instrumentation-http` +
    `@opentelemetry/exporter-prometheus` — **não** `http_server_request_duration_seconds`
    (convenção semântica mais nova de outras versões, que seria a adivinhação óbvia e errada).
  - `db_client_operation_duration_count/_sum/_bucket` — histograma em **segundos**, labels
    `db_system`, `db_operation_name`, `db_namespace` (via `@opentelemetry/instrumentation-pg`).
  - `db_client_connection_count` (gauge, `db_client_connection_state=used|idle`) e
    `db_client_connection_pending_requests` (gauge).
  - `target_info` (metadados do processo/serviço).
  - As métricas de negócio `cube_realtime_events_delivered_total`, `cube_realtime_connections`,
    `cube_realtime_propagation_ms`, `cube_permission_cache_hits_total`/`_misses_total` **não**
    apareceram nesse smoke test curto (exigem conexões WebSocket/checagens de permissão reais
    para serem incrementadas) — seus nomes foram confirmados por leitura direta do código-fonte
    (`apps/api/src/core/observability/metrics.ts`), não por execução.
  - Não observamos nenhuma métrica `redis_*`/`ioredis_*` — a auto-instrumentação do ioredis
    instalada (`@opentelemetry/instrumentation-ioredis`) gera **traces** (spans), não métricas
    Prometheus, nesta configuração.
- **Dashboards Grafana** (`infra/observability/grafana/*.json`, importáveis em qualquer Grafana
  apontado para o Prometheus certo): `api-health.json` (taxa de requisição, erro, latência p95 —
  meta 200ms —, latência por rota, duração de queries no Postgres), `realtime-propagation.json`
  (p50/p95/p99 de `cube_realtime_propagation_ms` — meta 300ms —, conexões ativas, eventos/min),
  `permission-cache.json` (taxa de acerto do cache de permissões).
- **Alertas Prometheus** (`infra/observability/prometheus/alerts.yml`): API fora do ar, taxa de
  erro 5xx alta, p95 de latência da API > 200ms, p95 de propagação realtime > 300ms, taxa de
  acerto do cache de permissões < 50%, conexões do Postgres > 80% de `max_connections`
  (requer `postgres_exporter`, não incluso), backlog de fila do BullMQ (requer um exporter de
  filas, não incluso), pod em crash loop / não-ready (requer `kube-state-metrics`, comum em
  qualquer `kube-prometheus-stack`).
- **Scrape:** `infra/observability/prometheus/scrape-config-example.yml` (Prometheus "cru", sem
  Operator) ou `serviceMonitor.enabled=true` no chart (requer Prometheus Operator — CRD
  `ServiceMonitor` — instalado no cluster; assumido, não verificado neste sandbox).
- **SLO:** `docs/runbooks/slo.md` — 99,9% de disponibilidade mensal, o que conta como "down", e a
  política de orçamento de erro (incluindo feature freeze quando esgotado).

## 8. Resposta a incidentes

Ver `docs/runbooks/`:

1. `api-down.md` — API fora do ar / pods em crash loop.
2. `postgres-pool-exhausted.md` — pool de conexões esgotado / suspeita de RLS mal configurado.
3. `fila-com-atraso.md` — fila do BullMQ com atraso crescente (worker não acompanha).
4. `migracao-falhou.md` — migração falhou no meio de um deploy (e a regra aditiva-primeiro).
5. `incidente-seguranca.md` — suspeita de vazamento de credencial (rotação de `ENCRYPTION_KEY`/
   `JWT_SECRET`, com a lista completa das 10 colunas `*_ciphertext` afetadas).

## 9. Lacunas reais (infraestrutura que este sandbox não tem)

Listadas aqui de propósito, em vez de escondidas:

- **Não existe cluster Kubernetes real nem credenciais de cluster neste ambiente.**
  `.github/workflows/deploy.yml` está correto na forma (`helm upgrade --install`,
  `workflow_dispatch`, gates de `environment`), mas falha de propósito com uma mensagem clara se
  `STAGING_KUBECONFIG`/`PRODUCTION_KUBECONFIG` não estiverem cadastrados — porque não estão, e não
  há como testá-lo de ponta a ponta aqui. O `TODO(ops)` no topo do arquivo lista exatamente o que
  um humano com acesso à infra precisa configurar.
- **Não existe um bucket S3 real de staging/produção neste ambiente.** O backup
  (`backup-postgres.sh`) e seu teste de restauração contra um dump real
  (`.github/workflows/backup-restore-test.yml`, passo `--from-s3`) dependem de
  `BACKUP_S3_ACCESS_KEY` etc., que não existem aqui — o workflow detecta isso e pula essa parte
  com um aviso, mas ainda roda a validação local (dump→restauração→`db:migrate`) de ponta a ponta
  contra um Postgres de teste do próprio job, o que já prova o mecanismo.
- **Não existe um Grafana/Prometheus real para importar os dashboards.** Os três JSON em
  `infra/observability/grafana/` nunca foram abertos num Grafana de verdade neste ambiente — as
  expressões PromQL foram escritas contra os nomes de métrica confirmados via
  `curl localhost:9464/metrics` (seção 7), mas a renderização visual em si não foi verificada.
- **Sentry não está integrado na aplicação.** CLAUDE.md §3 cita Sentry na stack de
  observabilidade, mas não há SDK do Sentry em `apps/api`/`apps/worker` hoje (confirmado por
  busca no código) — e não há DSN/conta de Sentry disponível neste sandbox para configurar.
  Adicionar o SDK é uma mudança de dependência da aplicação (não deste prompt de infra); fica
  registrado aqui como lacuna real, não resolvida.
- **Nenhum `helm upgrade --install` real foi executado contra um cluster** — só `helm lint` e
  `helm template` (saída renderizada revisada à mão) rodaram de verdade neste ambiente.
