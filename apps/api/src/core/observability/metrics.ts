import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('cube-track-api');

/** Métricas de negócio/infra próprias (as de HTTP/PG/Redis vêm da instrumentação automática). */
export const appMetrics = {
  realtimeDelivered: meter.createCounter('cube_realtime_events_delivered_total', {
    description: 'Eventos realtime entregues a sockets',
  }),
  realtimeConnections: meter.createUpDownCounter('cube_realtime_connections', {
    description: 'Conexões WebSocket abertas',
  }),
  realtimeLatency: meter.createHistogram('cube_realtime_propagation_ms', {
    description: 'Tempo entre a ocorrência do evento e a entrega ao socket',
    unit: 'ms',
  }),
  permissionCacheHits: meter.createCounter('cube_permission_cache_hits_total', {
    description: 'Acertos no cache de permissões',
  }),
  permissionCacheMisses: meter.createCounter('cube_permission_cache_misses_total', {
    description: 'Faltas no cache de permissões',
  }),
};
