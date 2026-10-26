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
  descriptionText: z.string().nullable().optional(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  replannedStartDate: z.string().nullable(),
  replannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualEndDate: z.string().nullable(),
  progress: z.string().nullable(),
  isMilestone: z.boolean().optional(),
  scheduleMode: z.enum(['auto', 'manual']).optional(),
  createdAt: z.string().optional(),
  createdBy: z.uuid().nullable().optional(),
  updatedBy: z.uuid().nullable().optional(),
  updatedAt: z.string(),
});
export type ItemSnapshot = z.infer<typeof ItemSnapshotSchema>;

export const EVENT_PAYLOADS = {
  /** Item passou a existir na lista ativa do board (criado, duplicado, restaurado ou movido para cá). */
  'item.created': z.object({
    item: ItemSnapshotSchema,
    reason: z.enum(['created', 'duplicated', 'restored', 'moved', 'imported']).optional(),
  }),
  'item.updated': z.object({
    itemId: z.uuid(),
    version: z.number().int(),
    changes: z.array(ItemFieldChangeSchema),
  }),
  /** Item saiu da lista ativa do board (lixeira, arquivo ou movido para outro board). */
  'item.deleted': z.object({
    itemId: z.uuid(),
    reason: z.enum(['deleted', 'archived', 'moved']).optional(),
  }),
  /** Botão de uma coluna `button` foi clicado (ADR 0051): dispara automações do tipo `button_clicked`. */
  'item.button_clicked': z.object({ itemId: z.uuid(), columnKey: z.string() }),
  /** Grupos do board mudaram: o cliente recarrega a estrutura do board. */
  'group.changed': z.object({
    groupId: z.uuid(),
    change: z.enum(['created', 'updated', 'deleted', 'archived', 'restored', 'moved']),
    changes: z.record(z.string(), z.unknown()).optional(),
  }),
  'column.created': z.object({ columnId: z.uuid(), key: z.string() }),
  'column.deleted': z.object({ columnId: z.uuid(), key: z.string() }),
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
  /** Edição, exclusão ou fixar/desafixar de uma atualização do feed do item. */
  'update.changed': z.object({
    updateId: z.uuid(),
    itemId: z.uuid(),
    change: z.enum(['edited', 'deleted', 'pinned', 'unpinned']),
  }),
  'reply.created': z.object({
    replyId: z.uuid(),
    updateId: z.uuid(),
    itemId: z.uuid(),
    authorId: z.uuid().nullable(),
    bodyText: z.string(),
  }),
  'reply.changed': z.object({
    replyId: z.uuid(),
    updateId: z.uuid(),
    itemId: z.uuid(),
    change: z.enum(['edited', 'deleted']),
  }),
  /** Reação adicionada/removida numa atualização ou resposta. */
  'reaction.changed': z.object({
    targetType: z.enum(['update', 'reply']),
    targetId: z.uuid(),
    itemId: z.uuid(),
  }),
  /** Arquivo anexado ao item (upload concluído ou excluído). */
  'attachment.changed': z.object({
    attachmentId: z.uuid(),
    itemId: z.uuid(),
    change: z.enum(['uploaded', 'deleted']),
  }),
  /** Checklist ou item de checklist criado/editado/excluído/marcado. */
  'checklist.changed': z.object({ itemId: z.uuid(), checklistId: z.uuid().nullable() }),
  /** Pedido de aprovação criado ou decidido (resolvido quando `status` sai de `pending`). */
  'approval.changed': z.object({
    requestId: z.uuid(),
    itemId: z.uuid(),
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
    requestedBy: z.uuid().nullable(),
    /** Presente só na criação: quem precisa decidir (para notificar os aprovadores). */
    approverIds: z.array(z.uuid()).optional(),
  }),
  /** Marco criado/editado/excluído/atingido (board inteiro recarrega a lista de marcos). */
  'milestone.changed': z.object({
    milestoneId: z.uuid(),
    boardId: z.uuid(),
    change: z.enum(['created', 'updated', 'deleted']),
  }),
  /** Baseline capturada, marcada como primária ou excluída. */
  'baseline.changed': z.object({
    baselineId: z.uuid(),
    boardId: z.uuid(),
    change: z.enum(['captured', 'primary_changed', 'deleted']),
  }),
  /** Dashboard criado/editado/excluído (ADR 0050): o cliente recarrega a lista/o dashboard aberto. */
  'dashboard.changed': z.object({
    dashboardId: z.uuid(),
    change: z.enum(['created', 'updated', 'deleted']),
  }),
  /** Widget criado/editado/excluído/reordenado: o cliente refaz a consulta de dados do dashboard. */
  'widget.changed': z.object({
    widgetId: z.uuid(),
    dashboardId: z.uuid(),
    change: z.enum(['created', 'updated', 'deleted', 'reordered']),
  }),
  /** Novo relato de saúde do projeto (ADR 0050): widgets `project_health` do board recarregam. */
  'project_health.reported': z.object({ healthId: z.uuid(), boardId: z.uuid() }),
  /** CRUD de automação (ADR 0051): `boardId` nulo = automação de workspace inteiro. */
  'automation.changed': z.object({
    automationId: z.uuid(),
    workspaceId: z.uuid(),
    boardId: z.uuid().nullable(),
    change: z.enum(['created', 'updated', 'deleted']),
  }),
  /** CRUD de fase de um board `kind: 'process'` (ADR 0051): o cliente recarrega o pipe e o Kanban. */
  'phase.changed': z.object({
    phaseId: z.uuid(),
    boardId: z.uuid(),
    change: z.enum(['created', 'updated', 'deleted', 'reordered']),
  }),
  /** CRUD do pipe, de regras de transição ou de definições de SLA (ADR 0051): recarrega a config. */
  'process_config.changed': z.object({
    boardId: z.uuid(),
    change: z.enum([
      'pipe_created',
      'pipe_updated',
      'pipe_deleted',
      'transition_rule_created',
      'transition_rule_updated',
      'transition_rule_deleted',
      'sla_created',
      'sla_updated',
      'sla_deleted',
    ]),
  }),
  /** Acompanhamento de SLA mudou de estado (ADR 0051): o cliente atualiza o indicador no item/cartão. */
  'sla.changed': z.object({
    trackerId: z.uuid(),
    itemId: z.uuid(),
    boardId: z.uuid(),
    status: z.enum(['running', 'warning', 'paused', 'met', 'breached', 'stopped']),
  }),
  /** CRUD de webhook de saída (ADR 0051), incluindo habilitar/desabilitar e desabilitação automática. */
  'webhook.changed': z.object({
    webhookId: z.uuid(),
    workspaceId: z.uuid().nullable(),
    boardId: z.uuid().nullable(),
    change: z.enum(['created', 'updated', 'deleted', 'enabled', 'disabled']),
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
  /** Estrutura do workspace mudou (pastas, boards, ordem): clientes recarregam a árvore filtrada. */
  'workspace.structure_changed': z.object({ workspaceId: z.uuid() }),
  /** Views do board mudaram (criação, renomeação, ordem, exclusão): só ids — o cliente recarrega. */
  'view.changed': z.object({ boardId: z.uuid(), viewId: z.uuid() }),
  /** Favoritos do usuário mudaram (sincroniza abas/dispositivos do mesmo usuário). */
  'favorites.changed': z.object({}),
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

export {
  PRESENCE_HEARTBEAT_SECONDS,
  PRESENCE_TTL_SECONDS,
  REALTIME_CHANNEL,
  rooms,
} from './realtime.js';
