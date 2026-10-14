import { z } from 'zod';

/** Filas BullMQ compartilhadas entre API (produtora) e worker (consumidor). */
export const QUEUES = {
  emails: 'emails',
  notifications: 'notifications',
  automations: 'automations',
  schedule: 'schedule',
  searchIndex: 'search-index',
  fileScan: 'file-scan',
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
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const EmailJobSchema = z.object({
  to: z.email(),
  template: z.enum(EMAIL_TEMPLATES),
  locale: z.string().default('pt-BR'),
  data: z.record(z.string(), z.string()),
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

export const ScheduleJobSchema = z.object({
  tenantId: z.uuid(),
  boardId: z.uuid(),
  /** Item cujas datas mudaram (null = recalcular o board inteiro). */
  itemId: z.uuid().nullable(),
  causationId: z.uuid().nullable(),
  depth: z.number().int().min(0).default(0),
});
export type ScheduleJob = z.infer<typeof ScheduleJobSchema>;

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
  'item.created': [QUEUES.searchIndex, QUEUES.automations],
  'item.updated': [QUEUES.searchIndex, QUEUES.automations, QUEUES.schedule],
  'item.deleted': [QUEUES.searchIndex],
  'board.updated': [QUEUES.searchIndex],
  'update.created': [QUEUES.searchIndex, QUEUES.notifications],
};
