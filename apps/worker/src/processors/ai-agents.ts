import { schema, withTenant, type DatabaseHandle, type Transaction } from '@cube-track/db';
import { decryptSecret } from '@cube-track/shared/crypto';
import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  DomainEventJobSchema,
  EVENT_TRIGGER_TYPES,
  MAX_AUTOMATION_DEPTH,
  dateArrivesMatches,
  estimateCostCents,
  isOverUsageLimit,
  localDate,
  parseCellText,
  parseProposedAction,
  parseTrigger,
  triggerMatches,
  type AiAgentConfigError,
  type AiModel,
  type AutomationActionSpec,
  type DomainEventJob,
} from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { v5 as uuidV5 } from 'uuid';

import type { Logger } from '../logger.js';
import { decideAgentAction } from '../ai-provider.js';
import { runAsSystem, type SystemUnit } from '../system-tx.js';

/** Namespace fixo (uuid v5) para sintetizar o `triggeringEventId` do gatilho `date_arrives`. */
const DATE_ARRIVES_NAMESPACE = 'a7e9a9f0-3e9a-4f0a-9f9b-1f2a3b4c5d6e';

const {
  aiAgentRuns,
  aiAgents,
  aiSettings,
  aiUsageLogs,
  boards,
  columnDefinitions,
  dropdownOptions,
  groups,
  items,
  memberships,
  statusLabels,
  teams,
  tenants,
  users,
} = schema;

type ItemRow = typeof items.$inferSelect;
type ColumnRow = typeof columnDefinitions.$inferSelect;
type AgentRow = typeof aiAgents.$inferSelect;

export interface AiAgentsDeps {
  database: DatabaseHandle;
  redis: Redis;
  logger: Logger;
  /** `ENCRYPTION_KEY` — mesma chave usada pela API para cifrar `ai_settings.api_key_ciphertext`. */
  encryptionKey: string;
  now?: () => Date;
  /** Injetável para teste (evita chamar a Anthropic de verdade) — padrão: `decideAgentAction`. */
  decide?: typeof decideAgentAction;
}

export type AiAgentOutcomeStatus =
  | 'proposed'
  | 'no_action'
  | 'not_matched'
  | 'ai_not_configured'
  | 'invalid_config'
  | 'duplicate';

export interface AiAgentOutcome {
  agentId: string;
  status: AiAgentOutcomeStatus;
}

function itemFields(item: ItemRow): Record<string, unknown> {
  return {
    ...item.values,
    name: item.name,
    groupId: item.groupId,
    plannedStartDate: item.plannedStartDate,
    plannedEndDate: item.plannedEndDate,
    replannedStartDate: item.replannedStartDate,
    replannedEndDate: item.replannedEndDate,
    actualStartDate: item.actualStartDate,
    actualEndDate: item.actualEndDate,
    progress: item.progress,
  };
}

function eventChanges(event: DomainEventJob): { field: string; value: unknown }[] {
  const changes = (event.payload as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter(
    (entry): entry is { field: string; value: unknown } =>
      typeof entry === 'object' && entry !== null && typeof (entry as { field?: unknown }).field === 'string',
  );
}

function eventColumnKey(event: DomainEventJob): string | undefined {
  const columnKey = (event.payload as { columnKey?: unknown }).columnKey;
  return typeof columnKey === 'string' ? columnKey : undefined;
}

/**
 * Avaliação e proposta de ação por agentes de IA (ADR 0055): o worker NUNCA executa a ação sozinho —
 * só decide (chamando a Anthropic) e grava `ai_agent_runs` com status `pending_approval`. A execução
 * de verdade acontece na API, quando um humano aprova (`POST /v1/ai-agent-runs/:id/approve`). Mesmo
 * padrão de profundidade/idempotência de `processors/automations.ts`, reaproveitando o motor de
 * gatilhos (`triggerMatches`/`dateArrivesMatches`) — agentes não têm `conditions` (só gatilho +
 * instruções livres para o modelo decidir).
 */
export function aiAgentsProcessor(deps: AiAgentsDeps) {
  const now = deps.now ?? (() => new Date());
  const decide = deps.decide ?? decideAgentAction;

  async function loadContext(event: DomainEventJob & { boardId: string }) {
    return withTenant(deps.database.db, { tenantId: event.tenantId, userId: null }, async (tx) => {
      const [board] = await tx
        .select({ workspaceId: boards.workspaceId })
        .from(boards)
        .where(eq(boards.id, event.boardId));
      if (board === undefined) return null;
      const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, event.tenantId));
      const rules = await tx
        .select()
        .from(aiAgents)
        .where(
          and(
            eq(aiAgents.isActive, true),
            isNull(aiAgents.deletedAt),
            inArray(sql<string>`${aiAgents.trigger} ->> 'type'`, [...EVENT_TRIGGER_TYPES]),
            or(
              eq(aiAgents.boardId, event.boardId),
              and(isNull(aiAgents.boardId), eq(aiAgents.workspaceId, board.workspaceId)),
            ),
          ),
        );
      return { rules, timezone: tenant?.timezone ?? 'America/Sao_Paulo' };
    });
  }

  async function boardColumns(tx: Transaction, boardId: string): Promise<ColumnRow[]> {
    return tx
      .select()
      .from(columnDefinitions)
      .where(and(eq(columnDefinitions.boardId, boardId), isNull(columnDefinitions.deletedAt)));
  }

  async function boardGroups(tx: Transaction, boardId: string) {
    return tx
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt), isNull(groups.archivedAt)));
  }

  async function columnsForModel(tx: Transaction, columns: readonly ColumnRow[]) {
    const out: { key: string; title: string; type: string; options: string[]; labels: { id: string; label: string }[]; dropdown: { id: string; label: string }[] }[] = [];
    for (const column of columns) {
      const labels =
        column.type === 'status'
          ? await tx
              .select({ id: statusLabels.id, label: statusLabels.label })
              .from(statusLabels)
              .where(and(eq(statusLabels.columnId, column.id), isNull(statusLabels.deletedAt)))
          : [];
      const dropdown =
        column.type === 'dropdown'
          ? await tx
              .select({ id: dropdownOptions.id, label: dropdownOptions.label })
              .from(dropdownOptions)
              .where(and(eq(dropdownOptions.columnId, column.id), isNull(dropdownOptions.deletedAt)))
          : [];
      out.push({
        key: column.key,
        title: column.title,
        type: column.type,
        options: [...labels, ...dropdown].map((entry) => entry.label),
        labels,
        dropdown,
      });
    }
    return out;
  }

  async function textDirectory(tx: Transaction) {
    const people = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(isNull(memberships.deletedAt));
    const teamRows = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.deletedAt));
    return { people, teams: teamRows };
  }

  /** Habilitado + chave configurada + abaixo do limite mensal — mesma regra de `AiUsageGuard` da API. */
  async function aiCallContext(tx: Transaction, tenantId: string): Promise<{ apiKey: string; model: AiModel } | null> {
    const [settings] = await tx.select().from(aiSettings).where(eq(aiSettings.tenantId, tenantId));
    if (settings === undefined || !settings.enabled || settings.apiKeyCiphertext === null) return null;
    const startOfMonth = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), 1));
    const [row] = await tx
      .select({
        tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}), 0)::int`,
        costCents: sql<number>`coalesce(sum(${aiUsageLogs.costCents}), 0)::int`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.tenantId, tenantId), gte(aiUsageLogs.createdAt, startOfMonth)));
    const totals = { tokens: row?.tokens ?? 0, costCents: row?.costCents ?? 0 };
    if (
      isOverUsageLimit(totals, {
        monthlyTokenLimit: settings.monthlyTokenLimit,
        monthlyCostLimitCents: settings.monthlyCostLimitCents,
      })
    )
      return null;
    const model = (AI_MODELS as readonly string[]).includes(settings.model) ? (settings.model as AiModel) : DEFAULT_AI_MODEL;
    return { apiKey: decryptSecret(settings.apiKeyCiphertext, deps.encryptionKey), model };
  }

  async function recordUsage(tx: Transaction, tenantId: string, model: AiModel, usage: { inputTokens: number; outputTokens: number }) {
    const costCents = estimateCostCents(model, usage.inputTokens, usage.outputTokens);
    await tx.insert(aiUsageLogs).values({
      tenantId,
      userId: null,
      feature: 'agent',
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costCents,
    });
    return costCents;
  }

  /** Avalia um agente já casado (gatilho verificado pelo chamador): decide e, se for o caso, propõe. */
  async function evaluateAgent(
    unit: SystemUnit,
    agent: AgentRow,
    item: ItemRow,
    triggeringEventId: string | null,
  ): Promise<AiAgentOutcomeStatus> {
    const { tx } = unit;
    const call = await aiCallContext(tx, agent.tenantId);
    if (call === null) return 'ai_not_configured';
    const [run] = await tx
      .insert(aiAgentRuns)
      .values({
        tenantId: agent.tenantId,
        agentId: agent.id,
        boardId: item.boardId,
        itemId: item.id,
        triggeringEventId,
        status: 'pending_approval',
        reasoning: '',
        proposedAction: { type: 'notify', config: { message: '' } },
      })
      .onConflictDoNothing()
      .returning({ id: aiAgentRuns.id });
    // Reserva a linha (dedupe) ANTES de chamar a Anthropic — evita gastar uma chamada e deixá-la
    // "perdida" quando o mesmo evento já foi processado (reentrega do BullMQ).
    if (run === undefined) return 'duplicate';

    const columns = await boardColumns(tx, item.boardId);
    const columnsModel = await columnsForModel(tx, columns);
    const groupsModel = await boardGroups(tx, item.boardId);
    const decision = await decide({
      apiKey: call.apiKey,
      model: call.model,
      instructions: agent.instructions,
      allowedActions: agent.allowedActions,
      itemContext: JSON.stringify({ item: itemFields(item) }),
      columns: columnsModel.map(({ key, title, type, options }) => ({ key, title, type, options })),
      groups: groupsModel,
    });
    const costCents = await recordUsage(tx, agent.tenantId, call.model, decision.usage);

    if (decision.action.type === 'no_action') {
      await tx.delete(aiAgentRuns).where(eq(aiAgentRuns.id, run.id));
      return 'no_action';
    }

    let proposed: { type: string; config: Record<string, unknown> } | null = null;
    if (decision.action.type === 'set_column_value') {
      const column = columns.find((entry) => entry.key === (decision.action as { columnKey: string }).columnKey);
      const model = columnsModel.find((entry) => entry.key === column?.key);
      if (column !== undefined && model !== undefined) {
        const directory = await textDirectory(tx);
        const parsed = parseCellText(
          { key: column.key, type: column.type, settings: column.settings, labels: model.labels, options: model.dropdown },
          (decision.action as { textValue: string }).textValue,
          directory,
        );
        if (parsed.ok && parsed.value !== null) {
          proposed = { type: 'set_column_value', config: { columnKey: column.key, value: parsed.value } };
        }
      }
    } else if (decision.action.type === 'move_to_group') {
      const targetId = (decision.action as { groupId: string }).groupId;
      if (groupsModel.some((group) => group.id === targetId)) {
        proposed = { type: 'move_to_group', config: { groupId: targetId } };
      }
    } else {
      const peopleColumn = columns.find((column) => column.type === 'people');
      proposed = {
        type: 'notify',
        config: {
          message: (decision.action as { message: string }).message,
          ...(peopleColumn === undefined ? {} : { peopleColumnKey: peopleColumn.key }),
        },
      };
    }

    if (proposed === null) {
      await tx.delete(aiAgentRuns).where(eq(aiAgentRuns.id, run.id));
      return 'no_action';
    }

    let action: AutomationActionSpec;
    try {
      action = parseProposedAction(proposed, agent.allowedActions);
    } catch (error) {
      deps.logger.warn(
        { agentId: agent.id, err: error as AiAgentConfigError },
        'Agente de IA propôs uma ação fora da configuração permitida — descartada',
      );
      await tx.delete(aiAgentRuns).where(eq(aiAgentRuns.id, run.id));
      return 'invalid_config';
    }

    await tx
      .update(aiAgentRuns)
      .set({ reasoning: decision.reasoning, proposedAction: action, inputTokens: decision.usage.inputTokens, outputTokens: decision.usage.outputTokens, costCents })
      .where(eq(aiAgentRuns.id, run.id));
    await unit.emit({
      type: 'ai_agent_run.changed',
      aggregateType: 'ai_agent_run',
      aggregateId: run.id,
      boardId: item.boardId,
      itemId: item.id,
      payload: { runId: run.id, agentId: agent.id, boardId: item.boardId, itemId: item.id, status: 'pending_approval' },
    });
    return 'proposed';
  }

  async function processEvent(job: Job): Promise<{ outcomes: AiAgentOutcome[]; skipped?: 'depth' }> {
    const event = DomainEventJobSchema.parse(job.data);
    if (event.type !== 'item.created' && event.type !== 'item.updated' && event.type !== 'item.button_clicked')
      return { outcomes: [] };
    if (event.boardId === null || event.itemId === null) return { outcomes: [] };
    if (event.depth >= MAX_AUTOMATION_DEPTH) {
      deps.logger.warn({ eventId: event.eventId, depth: event.depth }, 'Cadeia agente de IA → evento interrompida (profundidade máxima)');
      return { outcomes: [], skipped: 'depth' };
    }
    const boardId = event.boardId;
    const itemId = event.itemId;
    const context = await loadContext({ ...event, boardId });
    if (context === null) return { outcomes: [] };
    const changes = eventChanges(event);
    const outcomes: AiAgentOutcome[] = [];

    for (const agent of context.rules) {
      try {
        const status = await runAsSystem(
          deps.database,
          deps.redis,
          event.tenantId,
          { kind: 'automation', causationId: event.eventId, depth: event.depth + 1, correlationId: event.eventId },
          async (unit): Promise<AiAgentOutcomeStatus> => {
            const { tx } = unit;
            const trigger = parseTrigger(agent.trigger);
            const [item] = await tx.select().from(items).where(and(eq(items.id, itemId), isNull(items.deletedAt)));
            if (item === undefined) return 'not_matched';
            if (
              !triggerMatches(trigger, { type: event.type, changes, groupId: item.groupId, columnKey: eventColumnKey(event) })
            )
              return 'not_matched';
            return evaluateAgent(unit, agent, item, event.eventId);
          },
        );
        outcomes.push({ agentId: agent.id, status });
      } catch (error) {
        deps.logger.error({ agentId: agent.id, eventId: event.eventId, err: error }, 'Falha ao avaliar agente de IA');
        outcomes.push({ agentId: agent.id, status: 'invalid_config' });
      }
    }
    return { outcomes };
  }

  /**
   * Varredura diária do gatilho `date_arrives` (rotina `ai-agents-date-check`):
   * `app.ai_agent_date_check_candidates()` devolve só (tenant, agente) — cada agente é então casado
   * contra os itens do(s) seu(s) board(s) aqui em TypeScript, reaproveitando `dateArrivesMatches` já
   * testado em `packages/shared` (mesmo padrão de `automations.ts`/`app.date_arrives_candidates()`).
   */
  async function checkDateArrives(): Promise<{ outcomes: AiAgentOutcome[] }> {
    const today = now().toISOString().slice(0, 10);
    const result = await deps.database.db.execute<{ tenant_id: string; agent_id: string }>(
      sql`select * from app.ai_agent_date_check_candidates()`,
    );
    const outcomes: AiAgentOutcome[] = [];
    for (const row of result.rows) {
      outcomes.push(...(await checkAgentDateArrives(row.tenant_id, row.agent_id, today)));
    }
    return { outcomes };
  }

  async function checkAgentDateArrives(tenantId: string, agentId: string, today: string): Promise<AiAgentOutcome[]> {
    const loaded = await withTenant(deps.database.db, { tenantId, userId: null }, async (tx) => {
      const [agent] = await tx
        .select()
        .from(aiAgents)
        .where(and(eq(aiAgents.id, agentId), eq(aiAgents.isActive, true), isNull(aiAgents.deletedAt)));
      if (agent === undefined) return null;
      const trigger = parseTrigger(agent.trigger);
      if (trigger.type !== 'date_arrives') return null;
      const boardIds =
        agent.boardId !== null
          ? [agent.boardId]
          : (
              await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.workspaceId, agent.workspaceId), isNull(boards.deletedAt)))
            ).map((row) => row.id);
      const candidateItems =
        boardIds.length === 0 ? [] : await tx.select().from(items).where(and(inArray(items.boardId, boardIds), isNull(items.deletedAt)));
      const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
      return { agent, trigger, items: candidateItems, timezone: tenant?.timezone ?? 'America/Sao_Paulo' };
    });
    if (loaded === null) return [];
    const { agent, trigger, items: candidateItems, timezone } = loaded;
    const todayLocal = localDate(now(), timezone);
    const outcomes: AiAgentOutcome[] = [];
    for (const item of candidateItems) {
      const fields = itemFields(item);
      if (!dateArrivesMatches(trigger, fields[trigger.config.columnKey], todayLocal)) continue;
      const triggeringEventId = uuidV5(`${agentId}:${item.id}:${today}`, DATE_ARRIVES_NAMESPACE);
      try {
        const status = await runAsSystem(
          deps.database,
          deps.redis,
          tenantId,
          { kind: 'automation', causationId: null, depth: 1, correlationId: `ai-agents-date-check:${agentId}:${item.id}` },
          (unit) => evaluateAgent(unit, agent, item, triggeringEventId),
        );
        outcomes.push({ agentId, status });
      } catch (error) {
        deps.logger.error({ agentId, itemId: item.id, err: error }, 'Falha ao avaliar agente de IA (date_arrives)');
        outcomes.push({ agentId, status: 'invalid_config' });
      }
    }
    return outcomes;
  }

  return { processEvent, checkDateArrives };
}
