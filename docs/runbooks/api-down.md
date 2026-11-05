# Runbook — API fora do ar / pods em crash loop

## Sintomas

- `GET /health/live` ou `/health/ready` não respondem, ou respondem 503.
- Alerta `CubeTrackApiDown` ou `CubeTrackPodCrashLooping` (ver
  `infra/observability/prometheus/alerts.yml`) disparado.
- `kubectl get pods -n cube-track -l app.kubernetes.io/component=api` mostra `CrashLoopBackOff`
  ou `0/1 Ready`.
- Usuários reportam erro genérico no web (`app.cubetrack.*` não carrega dados) ou o Ingress
  devolve 502/504.

## Diagnóstico

1. **Status dos pods e eventos recentes:**
   ```bash
   kubectl -n cube-track get pods -l app.kubernetes.io/component=api -o wide
   kubectl -n cube-track describe pod <pod> | tail -40
   ```
   `OOMKilled` no último estado → ver passo 4. `CrashLoopBackOff` com `Error` → ver logs.

2. **Logs do container (pino, JSON estruturado):**
   ```bash
   kubectl -n cube-track logs <pod> -c api --previous --tail=200
   ```
   Procure por: erro de conexão com PostgreSQL/Redis logo na subida (ver
   `apps/api/src/core/database`, `core/redis`), erro de `ENCRYPTION_KEY`/`JWT_SECRET` ausentes ou
   inválidos (`apps/api/src/core/config/config.ts` valida isso no boot e derruba o processo), ou
   uma exceção não tratada em um módulo específico.

3. **A readiness (`/health/ready`) está reportando qual dependência caiu?**
   ```bash
   kubectl -n cube-track exec <pod> -- wget -qO- http://127.0.0.1:3001/health/ready
   ```
   Resposta `{"status":"down","checks":{"postgres":{"status":"down"...` → é o runbook
   `postgres-pool-exhausted.md`, não este. `{"status":"degraded", checks.search.status":"down"}`
   → Meilisearch fora do ar, api continua operando (degradado), menor urgência.

4. **Memória/CPU no limite?**
   ```bash
   kubectl -n cube-track top pod -l app.kubernetes.io/component=api
   ```
   Si bateu no `limits.memory` do `values-<ambiente>.yaml` → ver passo "Remediação" (aumentar
   limite ou investigar vazamento) antes de simplesmente reiniciar, ou o loop se repete.

5. **Rollout recente é o gatilho?**
   ```bash
   kubectl -n cube-track rollout history deployment/cube-track-api
   ```
   Se o crash começou logo após um `helm upgrade`, é provável regressão de código ou uma
   migração que o Job `cube-track-migrate-<N>` não aplicou corretamente — ver
   `docs/runbooks/migracao-falhou.md`.

## Remediação

- **Regressão de deploy:** `helm rollback cube-track <revisão-anterior> -n cube-track` para
  voltar à imagem anterior enquanto a causa é investigada. O chart não reaplica o Job de
  migração num rollback de `helm rollback` por padrão nas revisões do Helm (hooks
  `pre-install,pre-upgrade` não rodam em `rollback`) — se a migração da versão com problema já
  alterou o schema de forma incompatível com a versão anterior, ver
  `docs/runbooks/migracao-falhou.md` antes de fazer rollback.
- **OOM:** suba `api.resources.limits.memory` no overlay do ambiente e faça
  `helm upgrade --install ...` de novo; investigue a causa (vazamento, payload grande sem
  streaming) em paralelo, não só aumente o limite indefinidamente.
- **Dependência externa caída (Postgres/Redis gerenciado):** confirme o status do serviço
  gerenciado (RDS/ElastiCache etc.) antes de mexer nos pods da api — reiniciá-los não resolve se
  o banco está fora do ar.
- **Nada óbvio nos logs:** escale `api.replicaCount` temporariamente (mais réplicas absorvem
  carga enquanto se investiga) e abra uma cópia dos logs para análise offline:
  ```bash
  kubectl -n cube-track logs <pod> -c api --previous > /tmp/api-crash-$(date +%s).log
  ```

## Prevenção

- Garantir que `api.resources.requests/limits` no overlay do ambiente reflete o uso real (ver
  dashboard "API health" em `infra/observability/grafana/`).
- Readiness probe (`/health/ready`) já impede tráfego para um pod com dependência fora do ar —
  não remover nem afrouxar o `failureThreshold` sem motivo.
- Toda migração destrutiva segue a regra aditiva-primeiro de
  `docs/runbooks/migracao-falhou.md` para nunca derrubar pods da versão anterior durante o
  rollout.
