import { schema, withTenant, type DatabaseHandle, type Transaction } from '@cube-track/db';
import {
  AutomationConfigError,
  dateArrivesMatches,
  DomainEventJobSchema,
  EVENT_TRIGGER_TYPES,
  localDate,
  MAX_AUTOMATION_DEPTH,
  evaluateConditions,
  isColumnType,
  parseActions,
  parseColumnValue,
  parseTrigger,
  positionBetween,
  renderMessage,
  resolveDynamicValue,
  triggerMatches,
  type AutomationActionSpec,
  type AutomationTriggerSpec,
  type DomainEventJob,
  type ItemFieldChange,
} from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { v5 as uuidV5 } from 'uuid';

import type { Logger } from '../logger.js';
import { runAsSystem, type SystemUnit } from '../system-tx.js';

/** Namespace fixo (uuid v5) para sintetizar o `triggerEventId` de dedupe do gatilho `date_arrives`. */
const DATE_ARRIVES_NAMESPACE = 'b3f6a2b0-6b8e-4d9b-9e9a-6a6a6d7a5a10';

const {
  automations,
  automationRuns,
  items,
  groups,
  boards,
  columnDefinitions,
  statusLabels,
  teamMembers,
  notifications,
  tenants,
} = schema;

type ItemRow = typeof items.$inferSelect;
type ColumnRow = typeof columnDefinitions.$inferSelect;

/** Campos nativos graváveis por automação e seus bindings de coluna. */
const NATIVE_BINDINGS = {
  plannedStartDate: 'item.planned_start_date',
  plannedEndDate: 'item.planned_end_date',
  replannedStartDate: 'item.replanned_start_date',
  replannedEndDate: 'item.replanned_end_date',
  actualStartDate: 'item.actual_start_date',
  actualEndDate: 'item.actual_end_date',
  progress: 'item.progress',
} as const;
type NativeField = keyof typeof NATIVE_BINDINGS;
const FIELD_BY_BINDING = new Map<string, NativeField>(
  Object.entries(NATIVE_BINDINGS).map(([field, binding]) => [binding, field as NativeField]),
);

const READ_ONLY_TYPES = new Set([
  'auto_id',
  'formula',
  'mirror',
  'progress',
  'dependency',
  'button',
  'creation_log',
  'last_updated',
  'item_id',
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AutomationOutcome {
  automationId: string;
  status: 'succeeded' | 'failed' | 'not_matched' | 'duplicate';
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
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { field?: unknown }).field === 'string',
  );
}

/** Chave da coluna `button` clicada (evento `item.button_clicked`), quando presente. */
function eventColumnKey(event: DomainEventJob): string | undefined {
  const columnKey = (event.payload as { columnKey?: unknown }).columnKey;
  return typeof columnKey === 'string' ? columnKey : undefined;
}

function personIdsOf(
  values: Record<string, Record<string, unknown>>,
  keys: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const key of keys) {
    const list = values[key]?.personIds;
    if (Array.isArray(list)) list.forEach((id) => ids.add(String(id)));
  }
  return [...ids];
}

/** Estado mutável de uma execução: o item é alterado em memória e gravado uma única vez. */
interface Draft {
  item: ItemRow;
  values: Record<string, Record<string, unknown>>;
  fieldVersions: Record<string, number>;
  update: Partial<typeof items.$inferInsert>;
  changes: ItemFieldChange[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  activity: { action: string; columnKey: string; oldValue: unknown; newValue: unknown }[];
  log: Record<string, unknown>[];
}

function bump(draft: Draft, field: string): number {
  draft.fieldVersions[field] = (draft.fieldVersions[field] ?? 0) + 1;
  return draft.fieldVersions[field];
}

/**
 * Automações orientadas a eventos (`item.created`, `item.updated`): avalia gatilho e condições,
 * executa as ações numa transação com auditoria e outbox e registra a execução em
 * `automation_runs` (idempotente por evento + item). Cadeias são limitadas a
 * `MAX_AUTOMATION_DEPTH`; eventos gerados carregam `depth + 1` e `actor.kind = automation`.
 */
export function automationsProcessor(deps: {
  database: DatabaseHandle;
  redis: Redis;
  logger: Logger;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function loadContext(event: DomainEventJob & { boardId: string }) {
    return withTenant(deps.database.db, { tenantId: event.tenantId, userId: null }, async (tx) => {
      const [board] = await tx
        .select({ workspaceId: boards.workspaceId })
        .from(boards)
        .where(eq(boards.id, event.boardId));
      if (board === undefined) return null;
      const [tenant] = await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, event.tenantId));
      const rules = await tx
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.isEnabled, true),
            isNull(automations.deletedAt),
            inArray(sql<string>`${automations.trigger} ->> 'type'`, [...EVENT_TRIGGER_TYPES]),
            or(
              eq(automations.boardId, event.boardId),
              and(isNull(automations.boardId), eq(automations.workspaceId, board.workspaceId)),
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

  async function labelIdsFor(
    tx: Transaction,
    columns: readonly ColumnRow[],
    columnKey: string,
    label: string | undefined,
  ): Promise<string[]> {
    if (label === undefined) return [];
    const column = columns.find((entry) => entry.key === columnKey);
    if (column === undefined) return [];
    const rows = await tx
      .select({ id: statusLabels.id })
      .from(statusLabels)
      .where(
        and(
          eq(statusLabels.columnId, column.id),
          eq(statusLabels.label, label),
          isNull(statusLabels.deletedAt),
        ),
      );
    return rows.map((row) => row.id);
  }

  function setNative(draft: Draft, field: NativeField, value: unknown): void {
    if (value !== null && typeof value !== 'string')
      throw new AutomationConfigError(`Valor inválido para ${field}.`);
    if (field !== 'progress' && value !== null && !ISO_DATE.test(value))
      throw new AutomationConfigError(`Data inválida para ${field}.`);
    const previous = draft.item[field];
    if (previous === value) return;
    draft.before[field] = previous;
    draft.after[field] = value;
    (draft.update as Record<string, unknown>)[field] = value;
    draft.changes.push({ field, kind: 'native', value, version: bump(draft, field) });
    draft.activity.push({
      action: 'item.value_changed',
      columnKey: field,
      oldValue: previous,
      newValue: value,
    });
  }

  function setColumn(draft: Draft, column: ColumnRow, value: unknown): void {
    if (READ_ONLY_TYPES.has(column.type) || !isColumnType(column.type)) {
      throw new AutomationConfigError(`A coluna "${column.key}" não aceita escrita.`);
    }
    const previous = draft.values[column.key] ?? null;
    let next: Record<string, unknown> | null = null;
    if (value !== null) {
      const raw = column.type === 'date' && typeof value === 'string' ? { d: value } : value;
      try {
        next = parseColumnValue(column.type, raw);
      } catch (error) {
        throw new AutomationConfigError(
          `Valor inválido para "${column.key}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    if (next === null) Reflect.deleteProperty(draft.values, column.key);
    else draft.values[column.key] = next;
    draft.update.values = draft.values;
    draft.before[column.key] = previous;
    draft.after[column.key] = next;
    draft.changes.push({
      field: column.key,
      kind: 'column',
      value: next,
      version: bump(draft, column.key),
    });
    draft.activity.push({
      action: 'item.value_changed',
      columnKey: column.key,
      oldValue: previous,
      newValue: next,
    });
  }

  async function runAction(
    unit: SystemUnit,
    draft: Draft,
    action: AutomationActionSpec,
    columns: readonly ColumnRow[],
    timezone: string,
    automationId: string,
  ): Promise<void> {
    const { tx } = unit;
    switch (action.type) {
      case 'move_to_group': {
        const targetId = action.config.groupId;
        if (targetId === draft.item.groupId) return;
        const [group] = await tx
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.id, targetId),
              eq(groups.boardId, draft.item.boardId),
              isNull(groups.deletedAt),
            ),
          );
        if (group === undefined)
          throw new AutomationConfigError('Grupo de destino não pertence ao board.');
        const [last] = await tx
          .select({ position: items.position })
          .from(items)
          .where(
            and(eq(items.groupId, targetId), isNull(items.parentItemId), isNull(items.deletedAt)),
          )
          .orderBy(desc(items.position))
          .limit(1);
        const position = positionBetween(last?.position ?? null, null);
        draft.before.groupId = draft.item.groupId;
        draft.after.groupId = targetId;
        draft.update.groupId = targetId;
        draft.update.position = position;
        draft.changes.push({
          field: 'group_id',
          kind: 'native',
          value: targetId,
          version: bump(draft, 'group_id'),
        });
        draft.changes.push({
          field: 'position',
          kind: 'native',
          value: position,
          version: bump(draft, 'position'),
        });
        draft.activity.push({
          action: 'item.moved',
          columnKey: 'group_id',
          oldValue: draft.item.groupId,
          newValue: targetId,
        });
        draft.log.push({ action: 'move_to_group', groupId: targetId });
        return;
      }
      case 'set_column_value': {
        const value = resolveDynamicValue(action.config.value, now(), timezone);
        const columnKey = 'columnKey' in action.config ? action.config.columnKey : null;
        const column =
          columnKey === null ? undefined : columns.find((entry) => entry.key === columnKey);
        if (columnKey !== null && column === undefined) {
          throw new AutomationConfigError(`Coluna "${columnKey}" não encontrada.`);
        }
        const binding =
          'binding' in action.config ? action.config.binding : (column?.binding ?? null);
        if (binding !== null) {
          const field = FIELD_BY_BINDING.get(binding);
          if (field === undefined)
            throw new AutomationConfigError(`Binding "${binding}" não é gravável.`);
          setNative(draft, field, value);
        } else if (column !== undefined) {
          setColumn(draft, column, value);
        }
        draft.log.push({ action: 'set_column_value', target: binding ?? column?.key, value });
        return;
      }
      case 'notify': {
        const recipients = new Set(action.config.userIds ?? []);
        const peopleKey = action.config.peopleColumnKey;
        if (peopleKey !== undefined) {
          const cell = draft.values[peopleKey];
          (Array.isArray(cell?.personIds) ? cell.personIds : []).forEach((id) =>
            recipients.add(String(id)),
          );
          const teamIds = Array.isArray(cell?.teamIds) ? cell.teamIds.map(String) : [];
          if (teamIds.length > 0) {
            const members = await tx
              .select({ userId: teamMembers.userId })
              .from(teamMembers)
              .where(inArray(teamMembers.teamId, teamIds));
            members.forEach((member) => recipients.add(member.userId));
          }
        }
        const title = renderMessage(action.config.message, {
          ...itemFields(draft.item),
          ...draft.values,
          name: draft.update.name ?? draft.item.name,
        });
        for (const userId of recipients) {
          const [created] = await tx
            .insert(notifications)
            .values({
              tenantId: draft.item.tenantId,
              userId,
              type: 'automation',
              title,
              boardId: draft.item.boardId,
              itemId: draft.item.id,
              entityType: 'automation',
              entityId: automationId,
            })
            .returning({ id: notifications.id });
          if (created === undefined) continue;
          await unit.emit({
            type: 'notification.created',
            aggregateType: 'notification',
            aggregateId: created.id,
            userId,
            payload: {
              notificationId: created.id,
              type: 'automation',
              title,
              itemId: draft.item.id,
              boardId: draft.item.boardId,
            },
          });
        }
        draft.log.push({ action: 'notify', recipients: recipients.size });
        return;
      }
    }
  }

  async function persistItem(
    unit: SystemUnit,
    draft: Draft,
    columns: readonly ColumnRow[],
    automationId: string,
  ): Promise<void> {
    if (draft.changes.length === 0) return;
    const { item } = draft;
    const [updated] = await unit.tx
      .update(items)
      .set({
        ...draft.update,
        fieldVersions: draft.fieldVersions,
        version: item.version + 1,
        updatedBy: null,
        updatedAt: sql`now()`,
      })
      .where(eq(items.id, item.id))
      .returning();
    if (updated === undefined) throw new Error(`Item ${item.id} desapareceu durante a automação.`);
    await unit.audit({
      action: 'item.updated',
      entityType: 'item',
      entityId: item.id,
      before: draft.before,
      after: draft.after,
      metadata: { automationId },
    });
    for (const entry of draft.activity)
      await unit.activity({ boardId: item.boardId, itemId: item.id, ...entry });
    const peopleKeys = columns
      .filter((column) => column.type === 'people')
      .map((column) => column.key);
    await unit.emit({
      type: 'item.updated',
      aggregateType: 'item',
      aggregateId: item.id,
      boardId: item.boardId,
      itemId: item.id,
      payload: { itemId: item.id, version: updated.version, changes: draft.changes },
      routing: {
        assigneeIds: [
          ...new Set([
            ...personIdsOf(item.values, peopleKeys),
            ...personIdsOf(updated.values, peopleKeys),
          ]),
        ],
        columnKeys: draft.changes
          .filter((change) => change.kind === 'column')
          .map((change) => change.field),
        boundFields: draft.changes
          .filter((change) => change.field in NATIVE_BINDINGS)
          .map((change) => NATIVE_BINDINGS[change.field as NativeField]),
      },
    });
  }

  /**
   * Executa as ações de uma regra já casada (gatilho e condições verificados pelo chamador):
   * grava `automation_runs` (idempotente por `triggerEventId` + item), aplica as ações sobre o
   * item e contabiliza `runCount`/`lastRunAt`. Reaproveitado pelo caminho por evento e pela
   * varredura diária de `date_arrives`.
   */
  async function executeAutomation(
    unit: SystemUnit,
    rule: typeof automations.$inferSelect,
    item: ItemRow,
    columns: readonly ColumnRow[],
    timezone: string,
    triggerEventId: string | null,
    depth: number,
    startedAt: number,
  ): Promise<AutomationOutcome['status']> {
    const { tx } = unit;
    const actions = parseActions(rule.actions);
    const [run] = await tx
      .insert(automationRuns)
      .values({
        tenantId: item.tenantId,
        automationId: rule.id,
        triggerEventId,
        itemId: item.id,
        status: 'running',
        depth,
        startedAt: now(),
      })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id });
    if (run === undefined) return 'duplicate';

    const draft: Draft = {
      item,
      values: { ...item.values },
      fieldVersions: { ...item.fieldVersions },
      update: {},
      changes: [],
      before: {},
      after: {},
      activity: [],
      log: [],
    };
    for (const action of actions) await runAction(unit, draft, action, columns, timezone, rule.id);
    await persistItem(unit, draft, columns, rule.id);
    await unit.audit({
      action: 'automation.executed',
      entityType: 'automation',
      entityId: rule.id,
      metadata: { itemId: item.id, triggerEventId, actions: draft.log },
    });
    await tx
      .update(automationRuns)
      .set({
        status: 'succeeded',
        finishedAt: now(),
        durationMs: Date.now() - startedAt,
        log: draft.log,
      })
      .where(eq(automationRuns.id, run.id));
    await tx
      .update(automations)
      .set({ runCount: sql`${automations.runCount} + 1`, lastRunAt: now() })
      .where(eq(automations.id, rule.id));
    return 'succeeded';
  }

  async function recordFailure(
    context: { tenantId: string; triggerEventId: string | null; depth: number },
    automationId: string,
    itemId: string,
    error: Error,
  ): Promise<void> {
    await withTenant(
      deps.database.db,
      { tenantId: context.tenantId, userId: null },
      async (tx) => {
        await tx
          .insert(automationRuns)
          .values({
            tenantId: context.tenantId,
            automationId,
            triggerEventId: context.triggerEventId,
            itemId,
            status: 'failed',
            depth: context.depth,
            startedAt: now(),
            finishedAt: now(),
            durationMs: 0,
            error: error.message.slice(0, 2000),
          })
          .onConflictDoNothing();
        await tx
          .update(automations)
          .set({ errorCount: sql`${automations.errorCount} + 1`, lastRunAt: now() })
          .where(eq(automations.id, automationId));
      },
    );
  }

  /** Resolve a regra `date_arrives` e o item candidatos a um trio devolvido pela varredura diária. */
  async function loadDateArrivesCandidate(
    tenantId: string,
    automationId: string,
    itemId: string,
  ): Promise<{
    rule: typeof automations.$inferSelect;
    trigger: Extract<AutomationTriggerSpec, { type: 'date_arrives' }>;
    item: ItemRow;
    columns: ColumnRow[];
    timezone: string;
  } | null> {
    return withTenant(deps.database.db, { tenantId, userId: null }, async (tx) => {
      const [rule] = await tx
        .select()
        .from(automations)
        .where(
          and(
            eq(automations.id, automationId),
            eq(automations.isEnabled, true),
            isNull(automations.deletedAt),
          ),
        );
      if (rule === undefined) return null;
      const trigger = parseTrigger(rule.trigger);
      if (trigger.type !== 'date_arrives') return null;
      const [item] = await tx
        .select()
        .from(items)
        .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
        .for('update');
      if (item === undefined) return null;
      const [tenant] = await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const columns = await boardColumns(tx, item.boardId);
      return { rule, trigger, item, columns, timezone: tenant?.timezone ?? 'America/Sao_Paulo' };
    });
  }

  /**
   * Varredura diária do gatilho `date_arrives` (rotina de manutenção `automations-date-check`):
   * `app.date_arrives_candidates()` devolve os trios (tenant, automação, item) cuja data (deslocada
   * pelo `offsetDays`) bate com hoje no fuso de cada tenant; cada trio é verificado de novo (condições
   * e `dateArrivesMatches`) e executado via `executeAutomation`, com o mesmo controle de idempotência
   * das automações por evento — aqui, por `triggerEventId` sintético (uuid v5 do dia + automação + item).
   */
  async function checkDateArrives(): Promise<{ outcomes: AutomationOutcome[] }> {
    const today = now().toISOString().slice(0, 10);
    const result = await deps.database.db.execute<{
      tenant_id: string;
      automation_id: string;
      item_id: string;
    }>(sql`select * from app.date_arrives_candidates()`);
    const outcomes: AutomationOutcome[] = [];
    for (const row of result.rows) {
      const triggerEventId = uuidV5(
        `${row.automation_id}:${row.item_id}:${today}`,
        DATE_ARRIVES_NAMESPACE,
      );
      try {
        const candidate = await loadDateArrivesCandidate(
          row.tenant_id,
          row.automation_id,
          row.item_id,
        );
        if (candidate === null) {
          outcomes.push({ automationId: row.automation_id, status: 'not_matched' });
          continue;
        }
        const { rule, trigger, item, columns, timezone } = candidate;
        const fields = itemFields(item);
        const todayLocal = localDate(now(), timezone);
        if (!dateArrivesMatches(trigger, fields[trigger.config.columnKey], todayLocal)) {
          outcomes.push({ automationId: rule.id, status: 'not_matched' });
          continue;
        }
        if (!evaluateConditions(rule.conditions, fields)) {
          outcomes.push({ automationId: rule.id, status: 'not_matched' });
          continue;
        }
        const started = Date.now();
        const status = await runAsSystem(
          deps.database,
          deps.redis,
          row.tenant_id,
          { kind: 'automation', causationId: null, depth: 1, correlationId: triggerEventId },
          (unit) =>
            executeAutomation(unit, rule, item, columns, timezone, triggerEventId, 1, started),
        );
        outcomes.push({ automationId: rule.id, status });
      } catch (error) {
        if (!(error instanceof AutomationConfigError)) throw error;
        deps.logger.warn(
          { automationId: row.automation_id, itemId: row.item_id, err: error },
          'Automação (date_arrives) com configuração inválida',
        );
        await recordFailure(
          { tenantId: row.tenant_id, triggerEventId, depth: 1 },
          row.automation_id,
          row.item_id,
          error,
        );
        outcomes.push({ automationId: row.automation_id, status: 'failed' });
      }
    }
    return { outcomes };
  }

  async function processEvent(
    job: Job,
  ): Promise<{ outcomes: AutomationOutcome[]; skipped?: 'depth' }> {
    const event = DomainEventJobSchema.parse(job.data);
    if (
      event.type !== 'item.created' &&
      event.type !== 'item.updated' &&
      event.type !== 'item.button_clicked'
    )
      return { outcomes: [] };
    if (event.boardId === null || event.itemId === null) return { outcomes: [] };
    if (event.depth >= MAX_AUTOMATION_DEPTH) {
      deps.logger.warn(
        { eventId: event.eventId, depth: event.depth },
        'Cadeia de automações interrompida (profundidade máxima)',
      );
      return { outcomes: [], skipped: 'depth' };
    }
    const boardId = event.boardId;
    const itemId = event.itemId;
    const context = await loadContext({ ...event, boardId });
    if (context === null) return { outcomes: [] };
    const changes = eventChanges(event);
    const outcomes: AutomationOutcome[] = [];

    for (const rule of context.rules) {
      const started = Date.now();
      try {
        const status = await runAsSystem(
          deps.database,
          deps.redis,
          event.tenantId,
          {
            kind: 'automation',
            causationId: event.eventId,
            depth: event.depth + 1,
            correlationId: event.eventId,
          },
          async (unit): Promise<AutomationOutcome['status']> => {
            const { tx } = unit;
            const trigger = parseTrigger(rule.trigger);
            const [item] = await tx
              .select()
              .from(items)
              .where(and(eq(items.id, itemId), isNull(items.deletedAt)))
              .for('update');
            if (item === undefined) return 'not_matched';
            const columns = await boardColumns(tx, item.boardId);
            const labelIds =
              trigger.type === 'column_value_changed'
                ? await labelIdsFor(tx, columns, trigger.config.columnKey, trigger.config.toLabel)
                : [];
            if (
              trigger.type === 'column_value_changed' &&
              trigger.config.toLabel !== undefined &&
              labelIds.length === 0
            )
              return 'not_matched';
            if (
              !triggerMatches(
                trigger,
                { type: event.type, changes, groupId: item.groupId, columnKey: eventColumnKey(event) },
                labelIds,
              )
            )
              return 'not_matched';
            if (!evaluateConditions(rule.conditions, itemFields(item))) return 'not_matched';
            return executeAutomation(
              unit,
              rule,
              item,
              columns,
              context.timezone,
              event.eventId,
              event.depth + 1,
              started,
            );
          },
        );
        outcomes.push({ automationId: rule.id, status });
      } catch (error) {
        if (!(error instanceof AutomationConfigError)) throw error;
        deps.logger.warn(
          { automationId: rule.id, eventId: event.eventId, err: error },
          'Automação com configuração inválida',
        );
        await recordFailure(
          { tenantId: event.tenantId, triggerEventId: event.eventId, depth: event.depth + 1 },
          rule.id,
          itemId,
          error,
        );
        outcomes.push({ automationId: rule.id, status: 'failed' });
      }
    }
    return { outcomes };
  }

  return { processEvent, checkDateArrives };
}
