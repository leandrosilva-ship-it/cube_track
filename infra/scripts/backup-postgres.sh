#!/bin/sh
# CUBE TRACK — backup diário do PostgreSQL para armazenamento S3-compatível.
#
# Rodado pelo CronJob `cube-track-backup` (infra/helm/cube-track/templates/backup-cronjob.yaml),
# na imagem infra/docker/backup/Dockerfile (pg_dump + mc). Pode também ser rodado manualmente:
#
#   DATABASE_URL=postgres://cubetrack:cubetrack@localhost:5432/cubetrack \
#   S3_ENDPOINT=http://localhost:9000 S3_ACCESS_KEY=cubetrack S3_SECRET_KEY=cubetrack-secret \
#   S3_BUCKET=cubetrack-backups S3_FORCE_PATH_STYLE=true \
#     ./infra/scripts/backup-postgres.sh
#
# Variáveis de ambiente obrigatórias (mesma convenção de nomes do .env.example / Secret do Helm):
#   DATABASE_URL        — papel dono do schema (ADR 0028), usado só para ler, nunca escrever.
#   S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, S3_FORCE_PATH_STYLE
# Opcional:
#   BACKUP_RETENTION_DAYS (padrão 30) — dumps mais antigos são apagados do bucket após o upload.
set -eu

: "${DATABASE_URL:?defina DATABASE_URL}"
: "${S3_ENDPOINT:?defina S3_ENDPOINT}"
: "${S3_ACCESS_KEY:?defina S3_ACCESS_KEY}"
: "${S3_SECRET_KEY:?defina S3_SECRET_KEY}"
: "${S3_BUCKET:?defina S3_BUCKET}"
S3_REGION="${S3_REGION:-us-east-1}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
PREFIX="postgres"
DUMP_FILE="/tmp/cubetrack-${STAMP}.dump"
OBJECT_PATH="cube-track-backup/${PREFIX}/${STAMP}.dump"

echo "[backup] iniciando pg_dump em formato custom (-Fc, compactado, restaurável com pg_restore)"
pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="${DATABASE_URL}" --file="${DUMP_FILE}"
DUMP_SIZE=$(du -h "${DUMP_FILE}" | cut -f1)
echo "[backup] dump gerado: ${DUMP_FILE} (${DUMP_SIZE})"

mc alias set backup-target "${S3_ENDPOINT}" "${S3_ACCESS_KEY}" "${S3_SECRET_KEY}" --api S3v4 >/dev/null
mc mb --ignore-existing "backup-target/${S3_BUCKET}" >/dev/null
mc cp "${DUMP_FILE}" "backup-target/${S3_BUCKET}/${OBJECT_PATH}"
echo "[backup] enviado para s3://${S3_BUCKET}/${OBJECT_PATH}"
rm -f "${DUMP_FILE}"

echo "[backup] aplicando retenção de ${BACKUP_RETENTION_DAYS} dias em s3://${S3_BUCKET}/${PREFIX}/"
mc find "backup-target/${S3_BUCKET}/${PREFIX}/" --older-than "${BACKUP_RETENTION_DAYS}d" --exec "mc rm {}" || true

echo "[backup] concluído com sucesso (${STAMP})"
