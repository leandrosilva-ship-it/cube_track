# Chart Helm — cube-track

Implanta `api`, `worker`, `web` e, quando `global.realtimeMode=separate` (ADR 0027), um
deployment `realtime` próprio (mesma imagem da api, `dist/main.realtime.js`) em Kubernetes.

PostgreSQL, Redis, S3 e Meilisearch **não** são implantados por este chart em staging/produção —
são serviços gerenciados externos (RDS/Cloud SQL, ElastiCache/Memorystore, um bucket S3 real,
Meilisearch Cloud ou uma instância dedicada). `docker-compose.yml`, na raiz do repo, continua
sendo a stack de desenvolvimento local; este chart é uma preocupação separada, para o deploy dos
serviços da própria aplicação.

## Honestidade sobre o que foi de fato testado

Este chart foi validado com `helm lint` e `helm template` (saída renderizada revisada à mão)
neste repositório. **Não existe cluster Kubernetes real disponível neste sandbox** — portanto
nenhum `helm upgrade --install` real foi executado contra um cluster. `docs/deploy.md` detalha
exatamente o que é real/executável hoje e o que depende de infraestrutura externa.

## Instalar / atualizar

```bash
# Primeira instalação em staging
helm upgrade --install cube-track infra/helm/cube-track \
  -f infra/helm/cube-track/values-staging.yaml \
  --namespace cube-track-staging --create-namespace \
  --set image.tag=<git-sha-ou-tag>

# Produção
helm upgrade --install cube-track infra/helm/cube-track \
  -f infra/helm/cube-track/values-production.yaml \
  --namespace cube-track --create-namespace \
  --set image.tag=<git-sha-ou-tag>

# Local (kind/minikube/k3d) — ver values-dev.yaml
helm upgrade --install cube-track infra/helm/cube-track \
  -f infra/helm/cube-track/values-dev.yaml \
  --namespace cube-track-dev --create-namespace
```

Checar antes de instalar: `helm lint infra/helm/cube-track -f <overlay>` e
`helm template cube-track infra/helm/cube-track -f <overlay>` para revisar o YAML renderizado.

## Migrações seguras (zero downtime)

Um `Job` (`templates/migration-job.yaml`) roda como hook Helm `pre-install,pre-upgrade` e executa
`pnpm --filter @cube-track/db db:migrate` **antes** de qualquer pod novo de api/worker/web subir.
Se o Job falhar, o Helm aborta o release — nenhum Deployment é tocado. Ver
`docs/runbooks/migracao-falhou.md` para o procedimento de rollback e a regra de migração
"aditiva-primeiro" que todo código de aplicação deve seguir a partir de agora.

## Secrets esperados

Este chart **não cria** o Secret de runtime — só referencia um que já deve existir no namespace
(`global.secretName`, por padrão `cube-track-secrets`), gerenciado por Sealed Secrets, External
Secrets Operator, ou criado manualmente. Nunca coloque valores reais em um `values-*.yaml`.

Chaves exigidas (nomes idênticos aos de `.env.example`, na raiz do repo — essa é a fonte da
verdade; atualize esta lista se `.env.example` mudar):

| Chave | Uso |
| --- | --- |
| `DATABASE_URL` | Dono do schema (migrations) — só o Job de migração e o CronJob de backup usam |
| `DATABASE_APP_URL` | Papel `app_rw`, usado pela api/worker em operação normal |
| `DATABASE_AUTH_URL` | Papel `app_auth` (ADR 0028), fluxos de autenticação |
| `DATABASE_RELAY_URL` | Papel `app_relay` (ADR 0028), outbox relay no worker |
| `REDIS_URL` | Cache, pub/sub do realtime, filas BullMQ |
| `JWT_SECRET` | Assinatura de access/refresh tokens |
| `ENCRYPTION_KEY` | AES-256-GCM (32 bytes base64) — cifra MFA, segredos de webhook, tokens de integração (ver `docs/runbooks/incidente-seguranca.md`) |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Valida webhooks de e-mail de entrada |
| `OAUTH_GOOGLE_CLIENT_ID` / `OAUTH_GOOGLE_CLIENT_SECRET` | Login social Google (opcional — vazio desativa) |
| `OAUTH_MICROSOFT_CLIENT_ID` / `OAUTH_MICROSOFT_CLIENT_SECRET` | Login social Microsoft (opcional) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Armazenamento de arquivos e backups |
| `MEILI_MASTER_KEY` / `MEILI_API_KEY` | Busca |
| `SMTP_URL` | Envio de e-mail pelo worker |
| `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD` | Autenticação básica do painel Bull Board |

Exemplo de criação manual (só para abrir caminho — prefira Sealed Secrets/External Secrets em
produção real):

```bash
kubectl create secret generic cube-track-staging-secrets -n cube-track-staging \
  --from-literal=DATABASE_URL=... \
  --from-literal=DATABASE_APP_URL=... \
  --from-literal=DATABASE_AUTH_URL=... \
  --from-literal=DATABASE_RELAY_URL=... \
  --from-literal=REDIS_URL=... \
  --from-literal=JWT_SECRET=$(openssl rand -base64 48) \
  --from-literal=ENCRYPTION_KEY=$(openssl rand -base64 32) \
  --from-literal=INBOUND_EMAIL_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  --from-literal=OAUTH_GOOGLE_CLIENT_ID= --from-literal=OAUTH_GOOGLE_CLIENT_SECRET= \
  --from-literal=OAUTH_MICROSOFT_CLIENT_ID= --from-literal=OAUTH_MICROSOFT_CLIENT_SECRET= \
  --from-literal=S3_ACCESS_KEY=... --from-literal=S3_SECRET_KEY=... \
  --from-literal=MEILI_MASTER_KEY=... --from-literal=MEILI_API_KEY=... \
  --from-literal=SMTP_URL=... \
  --from-literal=BULL_BOARD_USER=admin --from-literal=BULL_BOARD_PASSWORD=$(openssl rand -hex 16)
```

## Feature flags via deploy (`values.config`)

Qualquer chave em `.Values.config` vira variável de ambiente nos três serviços via ConfigMap
(`templates/configmap.yaml`). É o mecanismo de feature flag "de infraestrutura" deste prompt:
uma flag nova é uma chave nova em `config`, com um valor diferente por overlay de ambiente
(`values-dev.yaml`/`values-staging.yaml`/`values-production.yaml`), sem precisar de admin UI nem
tabela no banco. Trocar o valor exige um novo `helm upgrade` (não é toggle em tempo real) — ver
`docs/deploy.md` "Feature flags" para o que isso cobre e o que não cobre.

## Autoscaling

- `api` e `web`: `HorizontalPodAutoscaler` por CPU, pronto para uso (`templates/hpa.yaml`).
- `worker`: autoscaling por CPU é uma aproximação pobre de "fila crescendo" — por padrão fica
  desligado (`worker.autoscaling.enabled: false`); ajuste `replicaCount` manualmente ou habilite
  com um KEDA ScaledObject (scaler `redis`/`prometheus` sobre o tamanho das filas BullMQ,
  `packages/shared/src/jobs.ts` `QUEUES`) instalado à parte no cluster.
- O ideal para `api`/`realtime` seria também escalar pela métrica de negócio
  `cube_realtime_connections` (conexões WebSocket), já exportada via Prometheus — isso exige um
  adaptador de métricas externas (Prometheus Adapter ou KEDA) instalado no cluster, fora do
  escopo deste chart. Documentado como comentário em `templates/hpa.yaml`.

## Gateway realtime separado (ADR 0027)

Com `global.realtimeMode=separate` e `realtime.enabled=true`, um Deployment `cube-track-realtime`
roda a mesma imagem da api com o comando `dist/main.realtime.js` — conexões WebSocket escalam e
fazem deploy à parte da API REST. Com `embedded` (padrão em `values-dev.yaml`), o próprio
deployment `api` atende REST e WebSocket; o deployment `realtime` fica com `enabled: false`.

## Estrutura

```
Chart.yaml
values.yaml               # defaults
values-dev.yaml            # cluster k8s local (opcional)
values-staging.yaml
values-production.yaml
templates/
  _helpers.tpl
  configmap.yaml
  api-deployment.yaml      # api + (opcional) realtime
  worker-deployment.yaml
  web-deployment.yaml
  services.yaml
  ingress.yaml
  hpa.yaml
  migration-job.yaml       # hook pre-install/pre-upgrade
  backup-cronjob.yaml
  servicemonitor.yaml       # requer Prometheus Operator; serviceMonitor.enabled
  NOTES.txt
```
