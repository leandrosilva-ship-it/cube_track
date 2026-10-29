import { z } from 'zod';

/** Filas BullMQ compartilhadas entre API (produtora) e worker (consumidor). */
export const QUEUES = {
  emails: 'emails',
  notifications: 'notifications',
  automations: 'automations',
  schedule: 'schedule',
  searchIndex: 'search-index',
  fileScan: 'file-scan',
  computed: 'computed',
  portfolio: 'portfolio',
  maintenance: 'maintenance',
  webhooks: 'webhooks',
  webhookDeliveries: 'webhook-deliveries',
  deadLetter: 'dead-letter',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Política padrão de retentativa (exponencial: 2s, 4s, 8s, 16s, 32s). */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export const EMAIL_TEMPLATES = [
  'magic_link',
  'password_reset',
  'email_verification',
  'invitation',
  'mention',
  'approval_requested',
  'notification_digest',
  'absence_requested',
  'absence_decided',
  'resource_request_created',
  'resource_request_fulfilled',
  'timesheet_submitted',
  'timesheet_decided',
  'risk_assigned',
  'issue_assigned',
  'project_health_alert',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const EmailJobSchema = z.object({
  to: z.email(),
  template: z.enum(EMAIL_TEMPLATES),
  locale: z.string().default('pt-BR'),
  data: z.record(z.string(), z.string()),
  /** Endereço de resposta por e-mail do item (ADR 0048) — ausente quando não há item associado. */
  replyTo: z.string().optional(),
});
export type EmailJob = z.infer<typeof EmailJobSchema>;

/** Evento de domínio despachado pelo relay do outbox para os consumidores. */
export const DomainEventJobSchema = z.object({
  eventId: z.uuid(),
  tenantId: z.uuid(),
  type: z.string(),
  boardId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  actorKind: z.enum(['user', 'automation', 'api', 'import', 'system']),
  depth: z.number().int().min(0),
  payload: z.record(z.string(), z.unknown()),
});
export type DomainEventJob = z.infer<typeof DomainEventJobSchema>;

/** Uma entrega (evento → um webhook específico), despachada pelo processador de fan-out. */
export const WebhookDeliveryJobSchema = z.object({
  webhookId: z.uuid(),
  event: DomainEventJobSchema,
});
export type WebhookDeliveryJob = z.infer<typeof WebhookDeliveryJobSchema>;

export const ScheduleJobSchema = z.object({
  tenantId: z.uuid(),
  boardId: z.uuid(),
  /** Item cujas datas mudaram (null = recalcular o board inteiro). */
  itemId: z.uuid().nullable(),
  causationId: z.uuid().nullable(),
  depth: z.number().int().min(0).default(0),
});
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>;

/**
 * Recálculo de colunas calculadas que dependem de outros itens (espelho, rollup, progresso por
 * subitens) ou do dia (fórmulas com TODAY). `itemIds` vazio com `boardId` = board inteiro.
 */
export const ComputedJobSchema = z.object({
  tenantId: z.uuid(),
  boardId: z.uuid(),
  itemIds: z.array(z.uuid()).max(5_000),
  /** Só colunas que dependem do dia (fórmulas voláteis). */
  volatileOnly: z.boolean().default(false),
  causationId: z.uuid().nullable(),
  depth: z.number().int().min(0).default(0),
});
export type ComputedJob = z.infer<typeof ComputedJobSchema>;

/** Rotinas periódicas de manutenção (repeatable jobs do BullMQ). */
export const MAINTENANCE_JOBS = [
  'purge-trash',
  'recompute-volatile',
  'automations-date-check',
  'sla-check',
  'notification-digest-hourly',
  'notification-digest-daily',
  'portfolio-health-daily',
] as const;
export type MaintenanceJob = (typeof MAINTENANCE_JOBS)[number];

/** Itens e grupos na lixeira são excluídos definitivamente após este prazo. */
export const TRASH_RETENTION_DAYS = 30;

export const SearchIndexJobSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('entity'),
    tenantId: z.uuid(),
    entity: z.enum(['item', 'board', 'update']),
    id: z.uuid(),
    deleted: z.boolean(),
  }),
  z.object({ kind: z.literal('reindex-tenant'), tenantId: z.uuid() }),
]);
export type SearchIndexJob = z.infer<typeof SearchIndexJobSchema>;

export const FileScanJobSchema = z.object({
  tenantId: z.uuid(),
  attachmentId: z.uuid(),
  versionId: z.uuid(),
  storageKey: z.string(),
});
export type FileScanJob = z.infer<typeof FileScanJobSchema>;

export const DeadLetterJobSchema = z.object({
  queue: z.string(),
  jobId: z.string().nullable(),
  name: z.string(),
  data: z.unknown(),
  failedReason: z.string(),
  attemptsMade: z.number().int(),
  failedAt: z.string(),
});
export type DeadLetterJob = z.infer<typeof DeadLetterJobSchema>;

/** Tipos de evento que cada consumidor recebe do relay. */
export const EVENT_CONSUMERS: Record<string, readonly QueueName[]> = {
  'item.created': [QUEUES.searchIndex, QUEUES.automations, QUEUES.computed, QUEUES.portfolio],
  'item.updated': [
    QUEUES.searchIndex,
    QUEUES.automations,
    QUEUES.schedule,
    QUEUES.computed,
    QUEUES.portfolio,
  ],
  'item.deleted': [QUEUES.searchIndex, QUEUES.computed, QUEUES.portfolio],
  'item.button_clicked': [QUEUES.automations],
  'column.created': [QUEUES.computed],
  'column.updated': [QUEUES.computed],
  'board.updated': [QUEUES.searchIndex],
  'update.created': [QUEUES.searchIndex, QUEUES.notifications],
  'reply.created': [QUEUES.notifications],
  'approval.changed': [QUEUES.notifications],
  'absence.changed': [QUEUES.notifications],
  'timesheet_approval.changed': [QUEUES.notifications],
  'resource_request.changed': [QUEUES.notifications],
  'risk.changed': [QUEUES.notifications, QUEUES.portfolio],
  'issue.changed': [QUEUES.notifications],
  'project_health.changed': [QUEUES.notifications],
  'budget.changed': [QUEUES.portfolio],
  'cost_entry.changed': [QUEUES.portfolio],
};
