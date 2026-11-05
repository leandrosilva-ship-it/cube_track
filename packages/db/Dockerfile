# syntax=docker/dockerfile:1.7
#
# CUBE TRACK — imagem de migração (packages/db), usada SÓ pelo Job pre-install/pre-upgrade do
# Helm chart (infra/helm/cube-track/templates/migration-job.yaml), nunca como serviço de longa
# duração. Não é uma das 3 imagens de aplicação (api/worker/web) — é a 4ª peça necessária para o
# item "migrações seguras (zero downtime)" do prompt 16: o Job precisa de uma imagem real para
# rodar `pnpm --filter @cube-track/db db:migrate`.
#
# packages/db não tem build próprio (script "db:migrate" roda via `tsx` direto do TypeScript
# fonte — ver package.json), então aqui mantemos as devDependencies (tsx, typescript) em vez do
# padrão `pnpm deploy --prod` usado em apps/api e apps/worker.
#
# Build sempre a partir da raiz do monorepo:
#   docker build -f packages/db/Dockerfile -t cube-track-db-migrate:local .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY . .
# Install filtrado: só @cube-track/db e suas dependências de workspace (@cube-track/shared) —
# evita puxar node_modules de apps/web (Next, Playwright) ou apps/api/worker para esta imagem.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --filter "@cube-track/db..." --frozen-lockfile

FROM node:${NODE_VERSION} AS runtime
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate \
    && addgroup -S cubetrack -g 10001 \
    && adduser -S cubetrack -G cubetrack -u 10001
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps --chown=cubetrack:cubetrack /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps --chown=cubetrack:cubetrack /app/node_modules ./node_modules
COPY --from=deps --chown=cubetrack:cubetrack /app/packages/db ./packages/db
COPY --from=deps --chown=cubetrack:cubetrack /app/packages/shared ./packages/shared
USER cubetrack
# ENTRYPOINT fixo + CMD trocável: o Job usa o padrão (db:migrate); `db:seed`/`db:reset` podem
# ser rodados manualmente com `kubectl run ... --image=... -- db:seed` em ambientes de teste.
ENTRYPOINT ["pnpm", "--filter", "@cube-track/db", "run"]
CMD ["db:migrate"]
