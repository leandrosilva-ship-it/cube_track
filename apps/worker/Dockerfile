# syntax=docker/dockerfile:1.7
#
# CUBE TRACK — apps/worker (BullMQ: outbox relay, e-mails, notificações, automações,
# cronograma, busca, antivírus) + Bull Board em BOARD_PORT.
#
# Build sempre a partir da raiz do monorepo:
#   docker build -f apps/worker/Dockerfile -t cube-track-worker:local .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
# CI=true: evita o pnpm pedir confirmação interativa (TTY) ao podar node_modules no install
# filtrado "prod-deps" abaixo — sem efeito em runtime, só no build.
ENV CI=true
WORKDIR /app

FROM base AS deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
ENV NODE_ENV=production
RUN pnpm --filter @cube-track/worker run build

# Install filtrado e travado no lockfile: só @cube-track/worker e seus deps de workspace
# (@cube-track/db, @cube-track/shared — fonte, já inlinada no bundle do tsup). Ver
# apps/api/Dockerfile para por que isso substitui `pnpm deploy --legacy` aqui.
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@cube-track/worker..."

# Sem `apk add`: o processo do worker já trata SIGTERM/SIGINT com espera de jobs em andamento
# (apps/worker/src/main.ts, SHUTDOWN_TIMEOUT_MS), então não precisa de um init (tini/dumb-init)
# embutido na imagem — em Kubernetes, ajuste `terminationGracePeriodSeconds` no chart.
FROM node:${NODE_VERSION} AS runtime
RUN addgroup -S cubetrack -g 10001 \
    && adduser -S cubetrack -G cubetrack -u 10001
WORKDIR /app
ENV NODE_ENV=production
# pnpm não hoisteia tudo para a raiz: as dependências diretas de @cube-track/worker ficam
# symlinkadas em apps/worker/node_modules (apontando para node_modules/.pnpm na raiz) — por isso
# copiamos os dois, preservando a estrutura relativa do monorepo (ver apps/api/Dockerfile).
COPY --from=prod-deps --chown=cubetrack:cubetrack /app/node_modules ./node_modules
COPY --from=prod-deps --chown=cubetrack:cubetrack /app/apps/worker/node_modules ./apps/worker/node_modules
# package.json de apps/worker (não o da raiz do workspace): é dele que o Node lê "type": "module".
COPY --from=prod-deps --chown=cubetrack:cubetrack /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=cubetrack:cubetrack /app/apps/worker/dist ./apps/worker/dist
USER cubetrack
# BOARD_PORT (Bull Board) e METRICS_PORT (Prometheus) — não há endpoint HTTP de negócio aqui.
EXPOSE 3010 9464
# Sem rota /health dedicada no worker (processo sem servidor HTTP de domínio): a sondagem usa o
# endpoint de métricas do OpenTelemetry (sempre ativo) como sinal de "processo vivo e respondendo".
# wget vem do busybox do próprio Alpine (sem apk add adicional).
HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${METRICS_PORT:-9464}/metrics" || exit 1
CMD ["node", "--enable-source-maps", "--import", "./apps/worker/dist/instrumentation.js", "apps/worker/dist/main.js"]
