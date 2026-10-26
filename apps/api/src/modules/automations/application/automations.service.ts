import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  AutomationConfigError,
  parseActions,
  parseConditions,
  parseTrigger,
  type AutomationActionSpec,
  type AutomationTriggerSpec,
} from '@cube-track/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { automations, boards } = schema;

export interface AutomationDto {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  description: string | null;
  trigger: AutomationTriggerSpec;
  conditions: Record<string, unknown> | null;
  actions: AutomationActionSpec[];
  isEnabled: boolean;
  ownerId: string | null;
  templateKey: string | null;
  runCount: number;
  errorCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationInput {
  name: string;
  description?: string | null | undefined;
  trigger: { type: string; config: Record<string, unknown> };
  conditions?: Record<string, unknown> | null | undefined;
  actions: { type: string; config: Record<string, unknown> }[];
  isEnabled?: boolean | undefined;
}

export interface UpdateAutomationInput {
  name?: string | undefined;
  description?: string | null | undefined;
  trigger?: { type: string; config: Record<string, unknown> } | undefined;
  conditions?: Record<string, unknown> | null | undefined;
  actions?: { type: string; config: Record<string, unknown> }[] | undefined;
  isEnabled?: boolean | undefined;
}

type AutomationRow = typeof automations.$inferSelect;

function toDto(row: AutomationRow): AutomationDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    boardId: row.boardId,
    name: row.name,
    description: row.description,
    trigger: row.trigger as AutomationTriggerSpec,
    conditions: row.conditions,
    actions: row.actions as AutomationActionSpec[],
    isEnabled: row.isEnabled,
    ownerId: row.ownerId,
    templateKey: row.templateKey,
    runCount: row.runCount,
    errorCount: row.errorCount,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Lê e valida com um erro de domínio puro (`AutomationConfigError`), mapeado para 422/400. */
function parse<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof AutomationConfigError)
      throw new ValidationError([{ path: 'body', message: error.message }]);
    throw error;
  }
}

/**
 * CRUD de automações (ADR 0051): por board (a maioria) ou por workspace inteiro (`boardId` nulo).
 * Validação de gatilho/condições/ações reaproveita `@cube-track/shared` — a mesma lógica usada
 * pelo worker para executar e pelo construtor visual do frontend para pré-visualizar.
 */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listForBoard(user: AuthPrincipal, boardId: string): Promise<AutomationDto[]> {
    await this.access.assert(user, 'automation.manage', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(automations)
      .where(and(eq(automations.boardId, boardId), isNull(automations.deletedAt)))
      .orderBy(desc(automations.createdAt));
    return rows.map(toDto);
  }

  async listForWorkspace(user: AuthPrincipal, workspaceId: string): Promise<AutomationDto[]> {
    await this.access.assert(
      user,
      'workspace.manage',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    const rows = await this.runner.tx
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.workspaceId, workspaceId),
          isNull(automations.boardId),
          isNull(automations.deletedAt),
        ),
      )
      .orderBy(desc(automations.createdAt));
    return rows.map(toDto);
  }

  async createForBoard(
    user: AuthPrincipal,
    boardId: string,
    input: AutomationInput,
  ): Promise<AutomationDto> {
    await this.access.assert(user, 'automation.manage', { type: 'board', id: boardId }, 'Board');
    const [board] = await this.runner.tx
      .select({ workspaceId: boards.workspaceId })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    return this.insert(user, board.workspaceId, boardId, input);
  }

  async createForWorkspace(
    user: AuthPrincipal,
    workspaceId: string,
    input: AutomationInput,
  ): Promise<AutomationDto> {
    await this.access.assert(
      user,
      'workspace.manage',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    return this.insert(user, workspaceId, null, input);
  }

  async update(
    user: AuthPrincipal,
    automationId: string,
    input: UpdateAutomationInput,
  ): Promise<AutomationDto> {
    const existing = await this.locked(automationId);
    await this.assertManage(user, existing.workspaceId, existing.boardId);
    const trigger =
      input.trigger === undefined ? existing.trigger : parse(() => parseTrigger(input.trigger));
    const actions =
      input.actions === undefined ? existing.actions : parse(() => parseActions(input.actions));
    const conditions =
      input.conditions === undefined
        ? existing.conditions
        : (parse(() => parseConditions(input.conditions)) as Record<string, unknown> | null);
    const [row] = await this.runner.tx
      .update(automations)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        trigger,
        conditions,
        actions,
        isEnabled: input.isEnabled ?? existing.isEnabled,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, automationId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar automação');
    this.events.recordChange({
      action: 'automation.updated',
      entityType: 'automation',
      entityId: row.id,
      boardId: row.boardId,
      before: { name: existing.name, isEnabled: existing.isEnabled },
      after: { name: row.name, isEnabled: row.isEnabled },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'automation.changed',
      aggregateType: 'automation',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: {
        automationId: row.id,
        workspaceId: row.workspaceId,
        boardId: row.boardId,
        change: 'updated',
      },
      actorId: user.userId,
    });
    return toDto(row);
  }

  async remove(user: AuthPrincipal, automationId: string): Promise<void> {
    const existing = await this.locked(automationId);
    await this.assertManage(user, existing.workspaceId, existing.boardId);
    await this.runner.tx
      .update(automations)
      .set({ deletedAt: new Date() })
      .where(eq(automations.id, automationId));
    this.events.recordChange({
      action: 'automation.deleted',
      entityType: 'automation',
      entityId: automationId,
      boardId: existing.boardId,
      before: { name: existing.name },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'automation.changed',
      aggregateType: 'automation',
      aggregateId: automationId,
      boardId: existing.boardId,
      payload: {
        automationId,
        workspaceId: existing.workspaceId,
        boardId: existing.boardId,
        change: 'deleted',
      },
      actorId: user.userId,
    });
  }

  async duplicate(user: AuthPrincipal, automationId: string): Promise<AutomationDto> {
    const existing = await this.locked(automationId);
    await this.assertManage(user, existing.workspaceId, existing.boardId);
    return this.insert(user, existing.workspaceId, existing.boardId, {
      name: `${existing.name} (cópia)`,
      description: existing.description,
      trigger: existing.trigger,
      conditions: existing.conditions,
      actions: existing.actions,
      isEnabled: false,
    });
  }

  private async insert(
    user: AuthPrincipal,
    workspaceId: string,
    boardId: string | null,
    input: AutomationInput,
  ): Promise<AutomationDto> {
    const trigger = parse(() => parseTrigger(input.trigger));
    const actions = parse(() => parseActions(input.actions));
    const conditions = parse(() => parseConditions(input.conditions ?? null)) as Record<
      string,
      unknown
    > | null;
    const [row] = await this.runner.tx
      .insert(automations)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        boardId,
        name: input.name,
        description: input.description ?? null,
        trigger,
        conditions,
        actions,
        isEnabled: input.isEnabled ?? true,
        ownerId: user.userId,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar automação');
    this.events.recordChange({
      action: 'automation.created',
      entityType: 'automation',
      entityId: row.id,
      boardId: row.boardId,
      after: { name: row.name, trigger: row.trigger },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'automation.changed',
      aggregateType: 'automation',
      aggregateId: row.id,
      boardId: row.boardId,
      payload: {
        automationId: row.id,
        workspaceId: row.workspaceId,
        boardId: row.boardId,
        change: 'created',
      },
      actorId: user.userId,
    });
    return toDto(row);
  }

  private async locked(automationId: string): Promise<AutomationRow> {
    const [row] = await this.runner.tx
      .select()
      .from(automations)
      .where(and(eq(automations.id, automationId), isNull(automations.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Automação');
    return row;
  }

  private async assertManage(
    user: AuthPrincipal,
    workspaceId: string,
    boardId: string | null,
  ): Promise<void> {
    if (boardId === null) {
      await this.access.assert(
        user,
        'workspace.manage',
        { type: 'workspace', id: workspaceId },
        'Workspace',
      );
    } else {
      await this.access.assert(user, 'automation.manage', { type: 'board', id: boardId }, 'Board');
    }
  }
}
