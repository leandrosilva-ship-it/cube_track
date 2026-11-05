# syntax=docker/dockerfile:1.7
#
# CUBE TRACK — apps/web (Next.js App Router, output "standalone")
#
# Build sempre a partir da raiz do monorepo:
#   docker build -f apps/web/Dockerfile -t cube-track-web:local .
#
# `API_INTERNAL_URL` é lido em build time pelo next.config.ts para montar o rewrite same-origin
# de /v1 (ADR 0032) — se o valor mudar por ambiente, repita o build com --build-arg, ou aponte o
# rewrite para um Service interno estável do cluster (ex.: http://cube-track-api:3001) via o
# values-*.yaml do Helm chart (ver infra/helm/cube-track).

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ARG API_INTERNAL_URL=http://cube-track-api:3001
ENV NODE_ENV=production
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm --filter @cube-track/web run build

# next.config.ts tem `output: 'standalone'`: apps/web/.next/standalone já traz um node_modules
# pruned (só o necessário para rodar `server.js`), sem precisar de `pnpm deploy` aqui.
# Sem `apk add`: nada de pacotes extra do sistema na imagem final. O servidor standalone do
# Next não trata SIGTERM de forma especial, mas é stateless (sem jobs em andamento a esperar);
# em Kubernetes, ajuste `terminationGracePeriodSeconds` no chart se necessário.
FROM node:${NODE_VERSION} AS runtime
RUN addgroup -S cubetrack -g 10001 \
    && adduser -S cubetrack -G cubetrack -u 10001
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Saída "standalone" do Next: server.js + node_modules mínimo, mais os assets estáticos
# (public/ e .next/static) copiados à parte, nas pastas que o server.js espera encontrar.
COPY --from=build --chown=cubetrack:cubetrack /app/apps/web/.next/standalone ./
COPY --from=build --chown=cubetrack:cubetrack /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=cubetrack:cubetrack /app/apps/web/public ./apps/web/public
USER cubetrack
EXPOSE 3000
# wget vem do busybox do próprio Alpine (sem apk add adicional).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/" || exit 1
CMD ["node", "apps/web/server.js"]
