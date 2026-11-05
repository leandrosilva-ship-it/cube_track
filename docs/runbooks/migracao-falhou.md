# Runbook — migração falhou no meio de um deploy

## Contexto: por que a ordem importa (migrações seguras / zero downtime)

`infra/helm/cube-track/templates/migration-job.yaml` roda como hook Helm `pre-install,pre-upgrade`:
o `Job` de migração (`pnpm --filter @cube-track/db db:migrate`, imagem `packages/db/Dockerfile`)
precisa terminar com sucesso **antes** do Helm tocar nos Deployments de api/worker/web. Isso
garante que nenhum pod da versão nova rode contra um schema que ainda não tem a coluna/tabela que
seu código espera.

A contrapartida — que o chart sozinho **não garante**, é regra de processo para quem escreve
migrações e código de aplicação:

### Regra de migração aditiva-primeiro

1. **Adicionar antes de usar:** uma coluna ou tabela nova entra **nullable ou com `default`**,
   numa migração própria, sempre **antes** de qualquer código em `apps/api` ou `apps/worker`
   passar a lê-la ou escrevê-la. Essa migração é segura de rodar mesmo com os pods da versão
   anterior ainda no ar (eles simplesmente ignoram a coluna nova).
2. **Depois, o deploy do código** que usa a coluna nova. Esse `helm upgrade` roda a mesma
   migração de novo (idempotente — já aplicada, vira no-op) e sobe os pods novos.
3. **Remover só depois que ninguém mais lê:** uma coluna só pode ser dropada (ou um `NOT NULL`
   endurecido, ou um tipo estreitado) numa migração **posterior**, depois de confirmar que
   **nenhum pod da versão anterior** que ainda lê/escreve nela está no ar
   (`kubectl rollout status` concluído, sem pods antigos restantes).
4. Nunca combine as três etapas numa única migração + deploy — é exatamente essa combinação que
   quebra pods antigos e novos ao mesmo tempo durante o rollout (a versão antiga trava numa
   coluna que sumiu; a versão nova já esperava ela lá antes do commit terminar de propagar).

Violar essa regra é a causa mais comum do sintoma deste runbook.

## Sintomas

- `helm upgrade` termina com erro `Job failed` / `timed out waiting for condition` no hook de
  migração.
- `kubectl -n cube-track get jobs -l app.kubernetes.io/component=migrate` mostra `0/1` completo e
  `Failed`.
- Alerta `CubeTrackPodCrashLooping` não dispara aqui (o Job não é um Deployment) — o sinal é a
  própria saída do `helm upgrade` no pipeline de deploy (`.github/workflows/deploy.yml`) ou do
  comando manual.

## Diagnóstico

1. **Ver o erro exato do Job:**
   ```bash
   kubectl -n cube-track logs job/cube-track-migrate-<revisão> --tail=100
   ```
   Procure por: erro de SQL (sintaxe, coluna/tabela já existente, violação de constraint ao
   aplicar um `NOT NULL`/`UNIQUE` em dados existentes), timeout de conexão com o Postgres, ou
   `DATABASE_URL` ausente/errada no Secret (`global.secretName`).

2. **Qual migração falhou e o estado da tabela de controle do Drizzle:**
   ```sql
   select * from drizzle.__drizzle_migrations order by created_at desc limit 5;
   ```
   Confirma até onde as migrações foram aplicadas com sucesso antes da falha — o Drizzle aplica
   migrações de um arquivo `.sql` por vez; uma falha no meio de um arquivo com múltiplos
   statements pode deixar efeito parcial se o arquivo não estiver todo numa transação (ver o
   arquivo de migração em `packages/db/migrations/` para confirmar).

3. **A falha é por violação de constraint em dados existentes?** (ex.: `NOT NULL` numa coluna que
   tem linhas `null` hoje) — isso é sintoma direto de pular a etapa 1 da regra aditiva-primeiro
   acima: a migração deveria ter passado primeiro por "nullable + backfill" antes de endurecer a
   constraint.

## Remediação

1. **O Helm já abortou o release** (o hook falhou, então os Deployments de api/worker/web
   **não foram tocados** — a versão anterior continua rodando normalmente, sem downtime). Não há
   um "rollback" a fazer nos Deployments nesse caso específico; o problema está isolado na
   migração.
2. **Corrigir a migração:**
   - Se a migração ainda não foi aplicada em nenhum ambiente compartilhado (só falhou
     localmente/em CI): edite o arquivo de migração problemático diretamente e tente de novo.
   - Se a migração **já foi aplicada com sucesso em outro ambiente** (ex.: passou em staging, só
     falhou em produção por causa de dados diferentes): **nunca edite o arquivo já aplicado**
     (CLAUDE.md §4) — crie uma migração nova `--custom` que corrige o estado (ex.: faz o backfill
     que faltou) e, só então, uma migração seguinte que endurece a constraint.
3. **Limpar o Job falho antes de tentar de novo** (o hook `before-hook-creation` do chart já faz
   isso automaticamente no próximo `helm upgrade`, mas para rodar manualmente):
   ```bash
   kubectl -n cube-track delete job cube-track-migrate-<revisão>
   ```
4. **Reexecutar:** `helm upgrade --install cube-track infra/helm/cube-track -f <overlay> --set image.tag=<tag>`
   com a migração corrigida. Como as migrações já aplicadas são idempotentes (tabela de controle
   do Drizzle), só a(s) migração(ões) pendente(s) roda(m).
5. **Se o schema ficou num estado intermediário inconsistente** (raro, só acontece se uma
   migração sem transação falhar no meio): restaurar o backup mais recente
   (`docs/deploy.md` "Backup e restauração") num ambiente de teste primeiro para confirmar o
   procedimento de correção antes de aplicá-lo no banco real.

## Prevenção

- Toda migração que endurece uma constraint existente é precedida, em um deploy anterior, por uma
  migração que só adiciona (nullable/default) — e, se necessário, um job de backfill no worker.
- `pnpm --filter @cube-track/db exec drizzle-kit check` roda no `ci.yml` existente
  ("Migrações consistentes com o schema") — pega divergência entre o schema Drizzle e os arquivos
  de migração antes do merge, não no deploy.
- Teste a migração em staging (`values-staging.yaml`) antes de produção — é o que o período de
  observação de 24h da política de orçamento de erro (`docs/runbooks/slo.md`) cobre.
