# syntax=docker/dockerfile:1.7
#
# CUBE TRACK — imagem do CronJob de backup (infra/helm/cube-track/templates/backup-cronjob.yaml).
# Combina o `pg_dump` oficial do Postgres 16 com o cliente MinIO (`mc`), que o próprio projeto já
# usa em dev (docker-compose.yml, serviço minio-setup) e fala com qualquer S3 compatível — AWS,
# MinIO, Wasabi etc. — sem precisar instalar o aws-cli (Python) por cima.
#
# Build a partir da raiz do monorepo:
#   docker build -f infra/docker/backup/Dockerfile -t cube-track-backup:local .

FROM minio/mc:RELEASE.2025-04-16T18-13-26Z AS mc

FROM postgres:16-alpine AS runtime
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY infra/scripts/backup-postgres.sh /usr/local/bin/backup-postgres.sh
RUN chmod +x /usr/local/bin/backup-postgres.sh
# A imagem oficial do Postgres já cria o usuário `postgres` (uid 999) sem privilégios de root.
USER postgres
ENTRYPOINT ["/usr/local/bin/backup-postgres.sh"]
