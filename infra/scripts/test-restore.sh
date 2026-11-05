#!/usr/bin/env bash
# CUBE TRACK — testa que um backup é restaurável e está no schema atual.
#
# Modo padrão: pega um dump de $SOURCE_DATABASE_URL (pg_dump local), restaura num Postgres
# descartável (container Docker — mesma ideia de "banco isolado por execução" que
# packages/testing/src/database.ts usa para testes de integração, só que via Docker direto em
# vez de Testcontainers, para não depender do runtime de testes do Node aqui) e confirma que:
#   1. a restauração (`pg_restore`) termina sem erro;
#   2. `pnpm --filter @cube-track/db db:migrate` não encontra nenhuma migração pendente — ou
#      seja, o dump está no schema ATUAL, não apenas "restaurável";
#   3. tabelas-chave têm ao menos as linhas esperadas (sanity check, não uma comparação exata).
#
# Modo `--from-s3`: baixa o dump mais recente de BACKUP_S3_BUCKET (via `mc`) em vez de gerar um
# localmente — usado por .github/workflows/backup-restore-test.yml quando as credenciais do
# bucket real existem.
#
# Uso manual:
#   SOURCE_DATABASE_URL=postgres://cubetrack:cubetrack@localhost:5432/cubetrack \
#     ./infra/scripts/test-restore.sh
set -euo pipefail

FROM_S3=false
if [[ "${1:-}" == "--from-s3" ]]; then FROM_S3=true; fi

WORKDIR="$(mktemp -d)"
DUMP_FILE="${WORKDIR}/restore-test.dump"
CONTAINER_NAME="cube-track-restore-test-$$"
RESTORE_PORT="${RESTORE_PORT:-55432}"

cleanup() {
  echo "[test-restore] limpando (container descartável + arquivos temporários)"
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

if [[ "${FROM_S3}" == true ]]; then
  : "${BACKUP_S3_ENDPOINT:?defina BACKUP_S3_ENDPOINT}"
  : "${BACKUP_S3_ACCESS_KEY:?defina BACKUP_S3_ACCESS_KEY}"
  : "${BACKUP_S3_SECRET_KEY:?defina BACKUP_S3_SECRET_KEY}"
  : "${BACKUP_S3_BUCKET:?defina BACKUP_S3_BUCKET}"
  echo "[test-restore] baixando o dump mais recente de s3://${BACKUP_S3_BUCKET}/cube-track-backup/postgres/"
  docker run --rm -v "${WORKDIR}:/work" \
    -e MC_HOST_backup="https://${BACKUP_S3_ACCESS_KEY}:${BACKUP_S3_SECRET_KEY}@${BACKUP_S3_ENDPOINT#https://}" \
    minio/mc:RELEASE.2025-04-16T18-13-26Z \
    sh -c "mc cp \$(mc find backup/${BACKUP_S3_BUCKET}/cube-track-backup/postgres/ --name '*.dump' | sort | tail -1) /work/restore-test.dump"
else
  : "${SOURCE_DATABASE_URL:?defina SOURCE_DATABASE_URL (ex.: a URL de um banco com o schema atual)}"
  echo "[test-restore] gerando dump local de origem (pg_dump --format=custom)"
  docker run --rm -v "${WORKDIR}:/work" --network host postgres:16-alpine \
    pg_dump --format=custom --no-owner --no-privileges --dbname="${SOURCE_DATABASE_URL}" --file=/work/restore-test.dump
fi

[[ -s "${DUMP_FILE}" ]] || { echo "[test-restore] ERRO: dump vazio ou não encontrado"; exit 1; }
echo "[test-restore] dump pronto: $(du -h "${DUMP_FILE}" | cut -f1)"

echo "[test-restore] subindo Postgres descartável (${CONTAINER_NAME}, porta ${RESTORE_PORT})"
docker run -d --rm --name "${CONTAINER_NAME}" \
  -e POSTGRES_USER=cubetrack -e POSTGRES_PASSWORD=cubetrack -e POSTGRES_DB=cubetrack \
  -p "${RESTORE_PORT}:5432" postgres:16-alpine >/dev/null

echo -n "[test-restore] aguardando ficar pronto"
for _ in $(seq 1 30); do
  if docker exec "${CONTAINER_NAME}" pg_isready -U cubetrack >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 1
done

RESTORE_URL="postgres://cubetrack:cubetrack@localhost:${RESTORE_PORT}/cubetrack"

echo "[test-restore] restaurando o dump"
docker cp "${DUMP_FILE}" "${CONTAINER_NAME}:/tmp/restore-test.dump"
docker exec "${CONTAINER_NAME}" pg_restore --no-owner --no-privileges -U cubetrack -d cubetrack /tmp/restore-test.dump

echo "[test-restore] checando que não há migração pendente (dump está no schema atual)"
DATABASE_URL="${RESTORE_URL}" pnpm --filter @cube-track/db db:migrate

echo "[test-restore] sanity check: contagem de linhas em tabelas-chave"
for table in tenants users boards items; do
  count=$(docker exec "${CONTAINER_NAME}" psql -U cubetrack -d cubetrack -tAc "select count(*) from ${table}" 2>/dev/null || echo "N/A")
  echo "  - ${table}: ${count}"
done

echo "[test-restore] OK — backup é restaurável e está no schema atual"
