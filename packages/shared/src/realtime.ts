/**
 * Constantes do protocolo realtime sem dependência de Zod: o frontend importa este módulo
 * diretamente (`@cube-track/shared/realtime`) para não carregar os schemas no bundle.
 */

export const REALTIME_CHANNEL = 'cube:realtime:events';

/** Nomes de rooms (sempre prefixados pelo tenant). */
export const rooms = {
  tenant: (tenantId: string) => `t:${tenantId}`,
  user: (tenantId: string, userId: string) => `t:${tenantId}:u:${userId}`,
  board: (tenantId: string, boardId: string) => `t:${tenantId}:b:${boardId}`,
  item: (tenantId: string, itemId: string) => `t:${tenantId}:i:${itemId}`,
  dashboard: (tenantId: string, dashboardId: string) => `t:${tenantId}:d:${dashboardId}`,
} as const;

export const PRESENCE_TTL_SECONDS = 30;
export const PRESENCE_HEARTBEAT_SECONDS = 10;
