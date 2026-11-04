import type { AutomationActionSpec, AutomationActionType, AutomationTriggerSpec } from '@cube-track/shared';
import { DEFAULT_AI_MODEL } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { aiAgentRunStatus, aiFeature } from './_enums.js';
import { appendOnlyColumns, deletedAt, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, items, workspaces } from './structure.js';

/**
 * Módulo opcional de IA (ADR 0055): provedor Anthropic com chave/limites por TENANT (não por
 * workspace — diferente de `contracts`/`automations`, a configuração de IA é única por organização),
 * log de uso/custo para auditoria de LGPD, e agentes configuráveis que reaproveitam o motor de
 * gatilho/ação das automações (ADR 0051) com aprovação humana obrigatória antes de qualquer escrita.
 */

/** Configuração de IA do tenant — uma linha por tenant (`enabled: false` por padrão, LGPD). */
export const aiSettings = tenantTable(
  'ai_settings',
  {
    provider: text('provider').notNull().default('anthropic'),
    /** Cifrada (AES-256-GCM, `@cube-track/shared/crypto`) — nunca exposta em texto puro pela API. */
    apiKeyCiphertext: text('api_key_ciphertext'),
    model: text('model').notNull().default(DEFAULT_AI_MODEL),
    enabled: boolean('enabled').notNull().default(false),
    monthlyTokenLimit: integer('monthly_token_limit'),
    monthlyCostLimitCents: integer('monthly_cost_limit_cents'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('ai_settings_tenant_key').on(t.tenantId),
    check(
      'ai_settings_limits',
      sql`(${t.monthlyTokenLimit} is null or ${t.monthlyTokenLimit} >= 0) and (${t.monthlyCostLimitCents} is null or ${t.monthlyCostLimitCents} >= 0)`,
    ),
  ],
);

/** Log de uso/custo de IA (append-only) — soma mensal por tenant/feature para limite e LGPD. */
export const aiUsageLogs = tenantTable(
  'ai_usage_logs',
  {
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    feature: aiFeature('feature').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    cached: boolean('cached').notNull().default(false),
  },
  (t) => [index('ai_usage_logs_tenant_created_idx').on(t.tenantId, t.createdAt)],
  appendOnlyColumns(),
);

/** Agente configurável (instruções + gatilho + ações permitidas), por board ou por workspace inteiro. */
export const aiAgents = tenantTable(
  'ai_agents',
  {
    workspaceId: uuid('workspace_id').notNull(),
    boardId: uuid('board_id'),
    name: text('name').notNull(),
    instructions: text('instructions').notNull(),
    trigger: jsonb('trigger').$type<AutomationTriggerSpec>().notNull(),
    allowedActions: jsonb('allowed_actions').$type<AutomationActionType[]>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('ai_agents', t.tenantId, t.workspaceId, workspaces),
    tenantFk('ai_agents', t.tenantId, t.boardId, boards),
    index('ai_agents_board_active_idx')
      .on(t.boardId)
      .where(sql`${t.isActive} and ${t.deletedAt} is null`),
    index('ai_agents_trigger_type_idx').on(t.tenantId, sql`(${t.trigger} ->> 'type')`),
    check('ai_agents_allowed_actions_array', sql`jsonb_typeof(${t.allowedActions}) = 'array'`),
  ],
);

/**
 * Proposta de ação de um agente (nunca executada sozinha): o worker grava `pending_approval`;
 * `approve` executa de verdade (capturando `before_snapshot` antes de aplicar, para permitir
 * reverter) e `reject`/`revert` fecham o ciclo. Append-only na origem (`requestedAt`/proposta),
 * mutável apenas nos campos de decisão/execução/reversão.
 */
export const aiAgentRuns = tenantTable(
  'ai_agent_runs',
  {
    agentId: uuid('agent_id').notNull(),
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    /** Id do evento do outbox que disparou a avaliação (dedupe/trilha de causalidade). */
    triggeringEventId: uuid('triggering_event_id'),
    status: aiAgentRunStatus('status').notNull().default('pending_approval'),
    reasoning: text('reasoning').notNull(),
    proposedAction: jsonb('proposed_action').$type<AutomationActionSpec>().notNull(),
    /** Valor "antes" da coluna/grupo afetado, capturado na execução — só preenchido se executado. */
    beforeSnapshot: jsonb('before_snapshot').$type<Record<string, unknown>>(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decisionNote: text('decision_note'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedBy: uuid('reverted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    tenantFk('ai_agent_runs', t.tenantId, t.agentId, aiAgents),
    tenantFk('ai_agent_runs', t.tenantId, t.boardId, boards),
    tenantFk('ai_agent_runs', t.tenantId, t.itemId, items),
    index('ai_agent_runs_agent_idx').on(t.agentId, t.requestedAt),
    index('ai_agent_runs_status_idx')
      .on(t.tenantId, t.status)
      .where(sql`${t.status} = 'pending_approval'`),
    /** Dedupe: um mesmo evento não propõe duas vezes a mesma ação do mesmo agente/item (ADR 0051). */
    uniqueIndex('ai_agent_runs_dedupe_key')
      .on(t.agentId, t.triggeringEventId, t.itemId)
      .where(sql`${t.triggeringEventId} is not null`),
  ],
);
