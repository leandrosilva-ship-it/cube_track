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
  aiAgents: 'ai-agents',
  imports: 'imports',
  /** Sincronização de calendário (Google/Microsoft, ADR 0056) — direção item → evento de calendário
   * (`calendar-sync-periodic`, na mesma fila, cuida da direção calendário → item). */
  calendarSync: 'calendar-sync',
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
  'contract_balance_low',
  'contract_expiring',
  'service_order_stalled',
  'ai_agent_run_pending',
  'ai_agent_run_decided',
  'import_job_completed',
  /** Billing (ADR 0059): lembrete de dunning para o(s) proprietário(s)/administrador(es) do tenant —
   * assinatura `past_due` (pagamento recorrente falhou) ou renovação atrasada sem confirmação do
   * webhook. Disparado por `billing-reconciliation-daily`. */
  'billing_payment_issue',
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

/** Processa um job de importação em background (ADR 0056) — o commit em si (criar grupos/itens linha
 * a linha) roda aqui, nunca dentro da requisição HTTP que fez o upload. */
export const ImportJobPayloadSchema = z.object({
  tenantId: z.uuid(),
  importJobId: z.uuid(),
  userId: z.uuid(),
  boardId: z.uuid(),
});
export type ImportJobPayload = z.infer<typeof ImportJobPayloadSchema>;

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
  'contract-alerts-daily',
  'ai-agents-date-check',
  /** Direção calendário → item (ADR 0056): reconcilia eventos movidos/excluídos no Google
   * Calendar/Outlook com `calendar_sync_links` e também faz o polling de e-mail-para-item (Gmail/
   * Outlook) das conexões com essa opção ativada — ver `apps/worker/src/processors/calendar-sync.ts`. */
  'calendar-sync-periodic',
  /** Aplica a política de retenção de auditoria de cada tenant (ADR 0057, LGPD): arquiva/expurga
   * entradas de `audit_logs` mais antigas que `data_retention_policies.entity_type = 'audit_log'`. */
  'audit-retention-purge',
  /** Billing (ADR 0059): rede de segurança sobre `app.billing_reconciliation_candidates()` —
   * assinaturas pagas (`plan <> 'free'`) já `past_due` (reenvia o lembrete de dunning enquanto durar)
   * ou que ainda dizem `active` com o período corrente vencido há mais de 2 dias sem que o webhook de
   * renovação tenha chegado. NUNCA a fonte de verdade do estado da assinatura — isso é sempre o
   * webhook do Stripe (ou o adaptador stub Pix/boleto); esta rotina só avisa e, no caso de atraso
   * objetivo do webhook, não altera `subscriptions.status` sozinha (ver `docs/billing.md`). */
  'billing-reconciliation-daily',
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
  'item.created': [
    QUEUES.searchIndex,
    QUEUES.automations,
    QUEUES.computed,
    QUEUES.portfolio,
    QUEUES.aiAgents,
    QUEUES.calendarSync,
  ],
  'item.updated': [
    QUEUES.searchIndex,
    QUEUES.automations,
    QUEUES.schedule,
    QUEUES.computed,
    QUEUES.portfolio,
    QUEUES.aiAgents,
    QUEUES.calendarSync,
  ],
  'item.deleted': [QUEUES.searchIndex, QUEUES.computed, QUEUES.portfolio],
  'item.button_clicked': [QUEUES.automations, QUEUES.aiAgents],
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
  'ai_agent_run.changed': [QUEUES.notifications],
  /** Avisa quem iniciou a importação quando ela termina (sucesso ou falha) — o relatório de erro fica
   * disponível na tela, mas o usuário não precisa ficar com a aba aberta esperando (ADR 0056). */
  'import_job.changed': [QUEUES.notifications],
};
