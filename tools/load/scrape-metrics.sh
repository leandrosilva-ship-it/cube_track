#!/usr/bin/env bash
# Extrai o histograma Prometheus cube_realtime_propagation_ms (apps/api/src/core/observability/
# metrics.ts) de /metrics e calcula p50/p95 a partir dos buckets — para cruzar com o p95 medido do
# lado do cliente em tools/load/realtime.js (ver README). Requer a API rodando com
# OTEL_SDK_DISABLED=false (o padrão do .env de dev desativa o exportador Prometheus).
#
# Uso: tools/load/scrape-metrics.sh [metrics_url]
set -euo pipefail

METRICS_URL="${1:-http://localhost:${METRICS_PORT:-9464}/metrics}"

body="$(curl -sS "$METRICS_URL")"
metric_lines="$(printf '%s\n' "$body" | grep '^cube_realtime_propagation_ms_bucket')"

if [ -z "$metric_lines" ]; then
  echo "Nenhuma amostra de cube_realtime_propagation_ms em $METRICS_URL." >&2
  echo "A API precisa estar com OTEL_SDK_DISABLED=false e já ter entregue ao menos um evento realtime." >&2
  exit 1
fi

total="$(printf '%s\n' "$metric_lines" | grep 'le="+Inf"' | awk -F'} ' '{sum+=$2} END {print sum}')"
echo "Amostras totais: $total"

find_percentile() {
  local target="$1"
  local threshold
  threshold=$(awk -v t="$target" -v total="$total" 'BEGIN { print t * total }')
  printf '%s\n' "$metric_lines" | sed -E 's/.*le="([^"]+)"[^}]*} ([0-9.eE+]+)/\1 \2/' | sort -t' ' -k1 -g | \
    awk -v thr="$threshold" '$1 != "+Inf" && $2 >= thr { print $1; exit }'
}

p50="$(find_percentile 0.50)"
p95="$(find_percentile 0.95)"
echo "p50 (lado servidor, ocorrência -> emissão no socket): ${p50:-N/D} ms"
echo "p95 (lado servidor, ocorrência -> emissão no socket): ${p95:-N/D} ms"
