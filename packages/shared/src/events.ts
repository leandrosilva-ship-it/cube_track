import { z } from 'zod';

/**
 * Eventos realtime tipados (servidor → cliente). Contrato documentado em docs/realtime-events.md.
 * O envelope é o mesmo para todos os eventos; `payload` varia por `type`.
 */

export const ActorSchema = z.object({
  userId: z.uuid().nullable(),
  kind: z.enum(['user', 'automation', 'api', 'import', 'system']),
});

export const ItemFieldChangeSchema = z.object({
  /** Chave da coluna customizada ou campo nativo (`name`, `group_id`, `planned_end_date`…). */
  field: z.string(),
  kind: z.enum(['column', 'native']),
  value: z.unknown(),
  /** Versão do campo após a mudança (LWW por campo, ADR 0008). */
  version: z.number().int().nonnegative(),
});
export type ItemFieldChange = z.infer<typeof ItemFieldChangeSchema>;

const ItemSnapshotSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  groupId: z.uuid(),
  parentItemId: z.uuid().nullable(),
  name: z.string(),
  position: z.string(),
  values: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  replannedStartDate: z.string().nullable(),
  replannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualEndDate: z.string().nullable(),
  progress: z.string().nullable(),
  updatedAt: z.string(),
});
export type ItemSnapshot = z.infer<typeof ItemSnapshotSchema>;

export const EVENT_PAYLOADS = {
  'item.created': z.object({ item: ItemSnapshotSchema }),
  'item.updated': z.object({
    itemId: z.uuid(),
    version: z.number().int(),
    changes: z.array(ItemFieldChangeSchema),
  }),
  'item.deleted': z.object({ itemId: z.uuid() }),
  'column.updated': z.object({
    columnId: z.uuid(),
    key: z.string(),
    changes: z.record(z.string(), z.unknown()),
  }),
  'board.updated': z.object({ boardId: z.uuid(), changes: z.record(z.string(), z.unknown()) }),
  'update.created': z.object({
    updateId: z.uuid(),
    itemId: z.uuid(),
    authorId: z.uuid().nullable(),
    bodyText: z.string(),
  }),
  'notification.created': z.object({
    notificationId: z.uuid(),
    type: z.string(),
    title: z.string(),
    itemId: z.uuid().nullable(),
    boardId: z.uuid().nullable(),
  }),
  'permission.changed': z.object({
    scope: z.enum(['tenant', 'workspace', 'board']),
    resourceId: z.uuid().nullable(),
  }),
  'session.revoked': z.object({ sessionId: z.uuid() }),
  'presence.joined': z.object({
    room: z.string(),
    userId: z.uuid(),
    state: z.record(z.string(), z.unknown()),
  }),
  'presence.updated': z.object({
    room: z.string(),
    userId: z.uuid(),
    state: z.record(z.string(), z.unknown()),
  }),
  'presence.left': z.object({ room: z.string(), userId: z.uuid() }),
  /** O evento de sequência `seq` não é visível para este usuário (mantém a continuidade do seq). */
  'sequence.skipped': z.object({}),
} as const;

export type RealtimeEventType = keyof typeof EVENT_PAYLOADS;
export type RealtimeEventPayload<T extends RealtimeEventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;
export const REALTIME_EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as RealtimeEventType[];

/** Escopo de entrega do evento (determina a room). */
export const EventScopeSchema = z.object({
  boardId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  dashboardId: z.uuid().nullable(),
});
export type EventScope = z.infer<typeof EventScopeSchema>;

export interface RealtimeEvent<T extends RealtimeEventType = RealtimeEventType> {
  eventId: string;
  type: T;
  tenantId: string;
  scope: EventScope;
  /** Sequência monotônica por board (null para eventos fora de board). */
  seq: number | null;
  actor: z.infer<typeof ActorSchema>;
  clientMutationId: string | null;
  occurredAt: string;
  payload: RealtimeEventPayload<T>;
  schemaVersion: 1;
}

/**
 * Metadados internos de roteamento (gravados no outbox, nunca enviados ao cliente):
 * responsáveis do item (para convidados com escopo "assigned") e colunas afetadas.
 */
export interface EventRouting {
  assigneeIds?: string[];
  columnKeys?: string[];
  boundFields?: string[];
}

/** Envelope trafegado entre API/worker e os nós realtime (canal Redis). */
export interface RealtimeTransportMessage {
  event: RealtimeEvent;
  routing: EventRouting;
}

export const REALTIME_CHANNEL = 'cube:realtime:events';

/** Nomes de rooms (sempre prefixados pelo tenant). */
export const rooms = {
  tenant: (tenantId: string) => `t:${tenantId}`,
  user: (tenantId: string, userId: string) => `t:${tenantId}:u:${userId}`,
  board: (tenantId: string, boardId: string) => `t:${tenantId}:b:${boardId}`,
  item: (tenantId: string, itemId: string) => `t:${tenantId}:i:${itemId}`,
  dashboard: (tenantId: string, dashboardId: string) => `t:${tenantId}:d:${dashboardId}`,
} as const;

/** Mensagens cliente → servidor. Comandos de escrita trafegam por REST (ADR 0007). */
export const SubscribeRequestSchema = z.object({
  room: z.enum(['board', 'item', 'dashboard']),
  id: z.uuid(),
  lastSeq: z.number().int().nonnegative().optional(),
});
export type SubscribeRequest = z.infer<typeof SubscribeRequestSchema>;

export const PresenceHeartbeatSchema = z.object({
  room: z.enum(['board', 'item', 'dashboard']),
  id: z.uuid(),
  state: z
    .object({
      viewId: z.uuid().optional(),
      editing: z.object({ itemId: z.uuid(), field: z.string().max(64) }).optional(),
      typing: z.boolean().optional(),
    })
    .strict()
    .default({}),
});
export type PresenceHeartbeat = z.infer<typeof PresenceHeartbeatSchema>;

export const PRESENCE_TTL_SECONDS = 30;
export const PRESENCE_HEARTBEAT_SECONDS = 10;
