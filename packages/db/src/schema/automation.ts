import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { deliveryStatus, runStatus } from './_enums.js';
import { deletedAt, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, items, workspaces } from './structure.js';

export interface AutomationTrigger {
  type: string;
  config: Record<string, unknown>;
}
export interface AutomationAction {
  type: string;
  config: Record<string, unknown>;
}

/** Regra de automação "quando <gatilho> e <condições>, então <ações>" (board ou workspace). */
export const automations = tenantTable(
  'automations',
  {
    workspaceId: uuid('workspace_id').notNull(),
    boardId: uuid('board_id'),
    name: text('name').notNull(),
    description: text('description'),
    trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
    conditions: jsonb('conditions').$type<Record<string, unknown>>(),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull(),
    isEnabled: boolean('is_enabled').notNull().default(true),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    templateKey: text('template_key'),
    runCount: integer('run_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('automations', t.tenantId, t.workspaceId, workspaces),
    tenantFk('automations', t.tenantId, t.boardId, boards),
    index('automations_board_enabled_idx')
      .on(t.boardId)
      .where(sql`${t.isEnabled} and ${t.deletedAt} is null`),
    index('automations_trigger_type_idx').on(t.tenantId, sql`(${t.trigger} ->> 'type')`),
    check('automations_actions_array', sql`jsonb_typeof(${t.actions}) = 'array'`),
  ],
);

/** Execução de uma automação (append-only, exceto status/término). */
export const automationRuns = tenantTable(
  'automation_runs',
  {
    automationId: uuid('automation_id').notNull(),
    triggerEventId: uuid('trigger_event_id'),
    itemId: uuid('item_id'),
    status: runStatus('status').notNull().default('pending'),
    depth: smallint('depth').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    error: text('error'),
    log: jsonb('log').$type<Record<string, unknown>[]>().notNull().default([]),
  },
  (t) => [
    tenantFk('automation_runs', t.tenantId, t.automationId, automations),
    tenantFk('automation_runs', t.tenantId, t.itemId, items, 'set null'),
    index('automation_runs_automation_created_idx').on(t.automationId, t.createdAt),
    uniqueIndex('automation_runs_dedupe_key')
      .on(t.automationId, t.triggerEventId, t.itemId)
      .where(sql`${t.triggerEventId} is not null`),
    check('automation_runs_depth', sql`${t.depth} between 0 and 10`),
  ],
);

/** Webhook de saída. O segredo HMAC é armazenado cifrado pela aplicação (envelope encryption). */
export const webhooks = tenantTable(
  'webhooks',
  {
    workspaceId: uuid('workspace_id'),
    boardId: uuid('board_id'),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secretCiphertext: text('secret_ciphertext').notNull(),
    events: text('events').array().notNull(),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    isEnabled: boolean('is_enabled').notNull().default(true),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('webhooks', t.tenantId, t.workspaceId, workspaces),
    tenantFk('webhooks', t.tenantId, t.boardId, boards),
    check('webhooks_https', sql`${t.url} ~ '^https://'`),
    check('webhooks_events_not_empty', sql`cardinality(${t.events}) > 0`),
  ],
);

/** Tentativa de entrega de webhook (com retentativas exponenciais). */
export const webhookDeliveries = tenantTable(
  'webhook_deliveries',
  {
    webhookId: uuid('webhook_id').notNull(),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attempt: smallint('attempt').notNull().default(0),
    responseStatus: smallint('response_status'),
    responseBody: text('response_body'),
    error: text('error'),
    durationMs: integer('duration_ms'),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (t) => [
    tenantFk('webhook_deliveries', t.tenantId, t.webhookId, webhooks),
    uniqueIndex('webhook_deliveries_webhook_event_key').on(t.webhookId, t.eventId),
    index('webhook_deliveries_retry_idx')
      .on(t.nextRetryAt)
      .where(sql`${t.status} = 'pending'`),
    check('webhook_deliveries_response_body_len', sql`char_length(${t.responseBody}) <= 4096`),
  ],
);
