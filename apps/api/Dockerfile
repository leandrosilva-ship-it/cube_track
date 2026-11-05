# syntax=docker/dockerfile:1.7
#
# CUBE TRACK — apps/api
#
# Build sempre a partir da raiz do monorepo (contexto = raiz):
#   docker build -f apps/api/Dockerfile -t cube-track-api:local .
#
# Mesmo Dockerfile serve os dois modos do gateway realtime (ADR 0027): `REALTIME_MODE=embedded`
# roda `dist/main.js`; `REALTIME_MODE=separate` usa o entrypoint alternativo `dist/main.realtime.js`
# (ver infra/helm/cube-track, deployment "realtime").

ARG NODE_VERSION=22-alpine

# ───────────────────────────── base ─────────────────────────────
FROM node:${NODE_VERSION} AS base
# @node-rs/argon2 tem binário nativo pré-compilado para linux-musl (verificado no lockfile) —
# Alpine é seguro aqui, sem precisar de glibc/distroless.
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
# CI=true: evita o pnpm pedir confirmação interativa (TTY) ao podar node_modules no install
# filtrado "prod-deps" abaixo — sem efeito em runtime, só no build (GitHub Actions já define
# CI=true sozinho; aqui garantimos o mesmo comportamento num build local/Docker puro).
ENV CI=true
WORKDIR /app

# ───────────────────────────── deps (install completo p/ build) ─────────────────────────────
FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ───────────────────────────── build ─────────────────────────────
FROM deps AS build
ENV NODE_ENV=production
RUN pnpm --filter @cube-track/api run build

# ──────────────────── prod-deps (só as dependências de runtime) ────────────────────
# Install filtrado e travado no lockfile (determinístico, sem reresolver nada): só
# @cube-track/api e seus deps de workspace (@cube-track/db, @cube-track/shared — consumidos como
# fonte e já inlinados no bundle do tsup, então o que sobra aqui de fato são as dependências de
# terceiros deles, ex. pg/drizzle-orm). `pnpm install --filter` (em vez de `pnpm deploy`, que em
# modo legacy reresolve o workspace inteiro — inclusive pacotes não relacionados como
# packages/ui — e exige rede mesmo com o lockfile já satisfeito) evita isso.
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@cube-track/api..."

# ───────────────────────────── runtime ─────────────────────────────
# Sem `apk add`: a imagem final não precisa de pacotes do sistema. NestJS já chama
# `app.enableShutdownHooks()` (apps/api/src/bootstrap.ts e main.realtime.ts), então o processo
# Node trata SIGTERM corretamente sem um init (tini/dumb-init) — em Kubernetes, ajuste
# `terminationGracePeriodSeconds` no chart (infra/helm/cube-track) em vez de embutir um init aqui.
FROM node:${NODE_VERSION} AS runtime
RUN addgroup -S cubetrack -g 10001 \
    && adduser -S cubetrack -G cubetrack -u 10001
WORKDIR /app
ENV NODE_ENV=production
# pnpm não hoisteia tudo para a raiz: as dependências diretas de @cube-track/api ficam
# symlinkadas em apps/api/node_modules (apontando para o conteúdo real em node_modules/.pnpm na
# raiz) — por isso copiamos os dois, preservando a MESMA estrutura relativa do monorepo (symlink
# relativo quebraria se achatássemos tudo num node_modules só na raiz da imagem).
COPY --from=prod-deps --chown=cubetrack:cubetrack /app/node_modules ./node_modules
COPY --from=prod-deps --chown=cubetrack:cubetrack /app/apps/api/node_modules ./apps/api/node_modules
# package.json de apps/api (não o da raiz do workspace): é dele que o Node lê "type": "module"
# para interpretar apps/api/dist/*.js como ESM.
COPY --from=prod-deps --chown=cubetrack:cubetrack /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=cubetrack:cubetrack /app/apps/api/dist ./apps/api/dist
USER cubetrack
EXPOSE 3001 3002 9464
# wget vem do busybox do próprio Alpine (sem apk add adicional).
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3001}/health/live" || exit 1
CMD ["node", "--enable-source-maps", "--import", "./apps/api/dist/instrumentation.js", "apps/api/dist/main.js"]
