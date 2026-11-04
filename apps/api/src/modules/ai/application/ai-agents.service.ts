import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  AiAgentConfigError,
  isRevertibleActionType,
  parseAgentConfig,
  type AiAgentRunStatus,
  type AutomationActionSpec,
  type AutomationActionType,
  type AutomationTriggerSpec,
} from '@cube-track/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import { AiModuleGuard } from './ai-module-guard.service.js';

const { aiAgentRuns, aiAgents, notifications } = schema;

export interface AiAgentDto {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  instructions: string;
  trigger: AutomationTriggerSpec;
  allowedActions: AutomationActionType[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiAgentInput {
  name: string;
  instructions: string;
  trigger: { type: string; config: Record<string, unknown> };
  allowedActions: string[];
  isActive?: boolean | undefined;
}

export interface UpdateAiAgentInput {
  name?: string | undefined;
  instructions?: string | undefined;
  trigger?: { type: string; config: Record<string, unknown> } | undefined;
  allowedActions?: string[] | undefined;
  isActive?: boolean | undefined;
}

export interface AiAgentRunDto {
  id: string;
  agentId: string;
  boardId: string | null;
  itemId: string | null;
  status: AiAgentRunStatus;
  reasoning: string;
  proposedAction: AutomationActionSpec;
  beforeSnapshot: Record<string, unknown> | null;
  costCents: number;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  executedAt: string | null;
  revertedAt: string | null;
  revertedBy: string | null;
}

type AgentRow = typeof aiAgents.$inferSelect;
type RunRow = typeof aiAgentRuns.$inferSelect;

function toAgentDto(row: AgentRow): AiAgentDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    boardId: row.boardId,
    name: row.name,
    instructions: row.instructions,
    trigger: row.trigger,
    allowedActions: row.allowedActions,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRunDto(row: RunRow): AiAgentRunDto {
  return {
    id: row.id,
    agentId: row.agentId,
    boardId: row.boardId,
    itemId: row.itemId,
    status: row.status,
    reasoning: row.reasoning,
    proposedAction: row.proposedAction,
    beforeSnapshot: row.beforeSnapshot,
    costCents: row.costCents,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy,
    decisionNote: row.decisionNote,
    executedAt: row.executedAt?.toISOString() ?? null,
    revertedAt: row.revertedAt?.toISOString() ?? null,
    revertedBy: row.revertedBy,
  };
}

function parseConfig(input: { name: unknown; instructions: unknown; trigger: unknown; allowedActions: unknown }) {
  try {
    return parseAgentConfig(input);
  } catch (error) {
    if (error instanceof AiAgentConfigError) throw new ValidationError([{ path: 'body', message: error.message }]);
    throw error;
  }
}

/**
 * CRUD de agentes de IA configuráveis (ADR 0055) e ciclo de vida das propostas (`ai_agent_runs`):
 * o worker só PROPÕE (`pending_approval`); `approve` executa de verdade a ação real — via o service
 * do domínio correspondente, com `actorKind: 'automation'` (não existe um valor de enum próprio para
 * IA; `metadata.source: 'ai_agent'` diferencia na auditoria) — e captura o "antes" para permitir
 * reverter; `reject`/`revert` fecham o ciclo sem jamais apagar o registro original (nova linha de
 * auditoria a cada transição, nunca sobrescrita).
 */
@Injectable()
export class AiAgentsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly items: ItemsService,
    private readonly moduleGuard: AiModuleGuard,
  ) {}

  // --------------------------------------------------------------------------------- agentes ---

  async listForBoard(user: AuthPrincipal, boardId: string): Promise<AiAgentDto[]> {
    const { workspaceId } = await this.moduleGuard.assertBoardEnabled(boardId);
    await this.access.assert(user, 'ai.agents.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
    const rows = await this.runner.tx
      .select()
      .from(aiAgents)
      .where(and(eq(aiAgents.boardId, boardId), isNull(aiAgents.deletedAt)))
      .orderBy(desc(aiAgents.createdAt));
    return rows.map(toAgentDto);
  }

  async createForBoard(user: AuthPrincipal, boardId: string, input: AiAgentInput): Promise<AiAgentDto> {
    const { workspaceId } = await this.moduleGuard.assertBoardEnabled(boardId);
    await this.access.assert(user, 'ai.agents.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
    return this.insert(user, workspaceId, boardId, input);
  }

  async update(user: AuthPrincipal, agentId: string, input: UpdateAiAgentInput): Promise<AiAgentDto> {
    const existing = await this.lockedAgent(agentId);
    await this.moduleGuard.assertWorkspaceEnabled(existing.workspaceId);
    await this.assertManage(user, existing);
    const config = parseConfig({
      name: input.name ?? existing.name,
      instructions: input.instructions ?? existing.instructions,
      trigger: input.trigger ?? existing.trigger,
      allowedActions: input.allowedActions ?? existing.allowedActions,
    });
    const [row] = await this.runner.tx
      .update(aiAgents)
      .set({
        name: config.name,
        instructions: config.instructions,
        trigger: config.trigger,
        allowedActions: config.allowedActions,
        isActive: input.isActive ?? existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(aiAgents.id, agentId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar o agente.');
    this.events.recordChange({
      action: 'ai_agent.update',
      entityType: 'ai_agent',
      entityId: row.id,
      boardId: row.boardId,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: row.name, isActive: row.isActive },
    });
    await this.emitAgentChanged(user, row, 'updated');
    return toAgentDto(row);
  }

  async remove(user: AuthPrincipal, agentId: string): Promise<void> {
    const existing = await this.lockedAgent(agentId);
    await this.moduleGuard.assertWorkspaceEnabled(existing.workspaceId);
    await this.assertManage(user, existing);
    await this.runner.tx.update(aiAgents).set({ deletedAt: new Date() }).where(eq(aiAgents.id, agentId));
    this.events.recordChange({
      action: 'ai_agent.delete',
      entityType: 'ai_agent',
      entityId: agentId,
      boardId: existing.boardId,
      before: { name: existing.name },
    });
    await this.emitAgentChanged(user, existing, 'deleted');
  }

  // -------------------------------------------------------------------------------- execuções ---

  async listRuns(user: AuthPrincipal, agentId: string): Promise<AiAgentRunDto[]> {
    const agent = await this.lockedAgent(agentId);
    await this.moduleGuard.assertWorkspaceEnabled(agent.workspaceId);
    await this.assertApprove(user, agent);
    const rows = await this.runner.tx
      .select()
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.agentId, agentId))
      .orderBy(desc(aiAgentRuns.requestedAt))
      .limit(200);
    return rows.map(toRunDto);
  }

  /**
   * Executa a ação de verdade com `actorKind: 'automation'` (a ação foi decidida pela IA; a
   * aprovação humana só autoriza) — por isso o método inteiro roda dentro de UMA transação aberta
   * aqui mesmo (rota com `@Audited({ transactional: false })`, que impede o interceptor de abrir a
   * transação padrão com `actorKind: 'user'` antes de chegarmos aqui).
   */
  async approve(user: AuthPrincipal, runId: string, note: string | undefined): Promise<AiAgentRunDto> {
    return this.runner.run({ tenantId: user.tenantId, userId: user.userId, actorKind: 'automation' }, async () => {
      const { run, agent } = await this.lockedRun(runId);
      await this.moduleGuard.assertWorkspaceEnabled(agent.workspaceId);
      await this.assertApprove(user, agent);
      if (run.status !== 'pending_approval') {
        throw new ConflictError('Esta proposta já foi decidida.', 'ai_agent_run_already_decided');
      }
      if (run.itemId === null) {
        throw new UnprocessableError('Proposta sem item associado — nada a executar.', 'ai_agent_run_without_item');
      }
      const itemId = run.itemId;
      const action = run.proposedAction;
      let beforeSnapshot: Record<string, unknown> | null = null;
      if (action.type === 'set_column_value') {
        const columnKey = 'columnKey' in action.config ? action.config.columnKey : null;
        if (columnKey === null) {
          throw new UnprocessableError('Ação de agente só suporta colunas por chave.', 'ai_agent_action_unsupported');
        }
        const before = await this.items.get(user, itemId);
        beforeSnapshot = { columnKey, value: before.values[columnKey] ?? null };
        await this.items.update(user, itemId, { values: { [columnKey]: action.config.value } });
      } else if (action.type === 'move_to_group') {
        const before = await this.items.get(user, itemId);
        beforeSnapshot = { groupId: before.groupId };
        await this.items.update(user, itemId, { groupId: action.config.groupId });
      } else {
        await this.executeNotify(user, itemId, action);
      }
      this.events.recordChange({
        action: 'ai_agent_run.executed',
        entityType: 'ai_agent_run',
        entityId: run.id,
        itemId,
        boardId: run.boardId,
        metadata: { source: 'ai_agent', agentId: agent.id, runId: run.id },
        after: { proposedAction: action },
      });
      const [updated] = await this.runner.tx
        .update(aiAgentRuns)
        .set({
          status: 'executed',
          decidedAt: new Date(),
          decidedBy: user.userId,
          decisionNote: note ?? null,
          executedAt: new Date(),
          beforeSnapshot,
        })
        .where(eq(aiAgentRuns.id, runId))
        .returning();
      if (updated === undefined) throw new Error('Falha ao aprovar a execução.');
      await this.emitRunChanged(user, updated);
      return toRunDto(updated);
    });
  }

  async reject(user: AuthPrincipal, runId: string, note: string | undefined): Promise<AiAgentRunDto> {
    const { run, agent } = await this.lockedRun(runId);
    await this.moduleGuard.assertWorkspaceEnabled(agent.workspaceId);
    await this.assertApprove(user, agent);
    if (run.status !== 'pending_approval') {
      throw new ConflictError('Esta proposta já foi decidida.', 'ai_agent_run_already_decided');
    }
    const [updated] = await this.runner.tx
      .update(aiAgentRuns)
      .set({ status: 'rejected', decidedAt: new Date(), decidedBy: user.userId, decisionNote: note ?? null })
      .where(eq(aiAgentRuns.id, runId))
      .returning();
    if (updated === undefined) throw new Error('Falha ao rejeitar a execução.');
    this.events.recordChange({
      action: 'ai_agent_run.rejected',
      entityType: 'ai_agent_run',
      entityId: run.id,
      boardId: run.boardId,
      itemId: run.itemId,
      metadata: { source: 'ai_agent', agentId: agent.id, runId: run.id },
    });
    await this.emitRunChanged(user, updated);
    return toRunDto(updated);
  }

  /** Mesmo motivo do `approve`: roda inteiro numa transação própria com `actorKind: 'automation'`. */
  async revert(user: AuthPrincipal, runId: string): Promise<AiAgentRunDto> {
    return this.runner.run({ tenantId: user.tenantId, userId: user.userId, actorKind: 'automation' }, async () => {
      const { run, agent } = await this.lockedRun(runId);
      await this.moduleGuard.assertWorkspaceEnabled(agent.workspaceId);
      await this.assertApprove(user, agent);
      if (run.status !== 'executed') {
        throw new ConflictError('Só uma execução aplicada pode ser revertida.', 'ai_agent_run_not_executed');
      }
      if (!isRevertibleActionType(run.proposedAction.type) || run.beforeSnapshot === null || run.itemId === null) {
        throw new UnprocessableError('Esta ação não pode ser revertida.', 'ai_agent_run_not_revertible');
      }
      const itemId = run.itemId;
      const snapshot = run.beforeSnapshot as { columnKey?: string; value?: unknown; groupId?: string };
      if (run.proposedAction.type === 'set_column_value' && snapshot.columnKey !== undefined) {
        await this.items.update(user, itemId, { values: { [snapshot.columnKey]: snapshot.value ?? null } });
      } else if (run.proposedAction.type === 'move_to_group' && snapshot.groupId !== undefined) {
        await this.items.update(user, itemId, { groupId: snapshot.groupId });
      }
      this.events.recordChange({
        action: 'ai_agent_run.reverted',
        entityType: 'ai_agent_run',
        entityId: run.id,
        itemId,
        boardId: run.boardId,
        metadata: { source: 'ai_agent', agentId: agent.id, runId: run.id },
        after: { beforeSnapshot: snapshot },
      });
      const [updated] = await this.runner.tx
        .update(aiAgentRuns)
        .set({ status: 'reverted', revertedAt: new Date(), revertedBy: user.userId })
        .where(eq(aiAgentRuns.id, runId))
        .returning();
      if (updated === undefined) throw new Error('Falha ao reverter a execução.');
      await this.emitRunChanged(user, updated);
      return toRunDto(updated);
    });
  }

  // ------------------------------------------------------------------------------- internos ---

  private async executeNotify(
    user: AuthPrincipal,
    itemId: string,
    action: Extract<AutomationActionSpec, { type: 'notify' }>,
  ): Promise<void> {
    const item = await this.items.get(user, itemId);
    const recipients = new Set(action.config.userIds ?? []);
    const peopleKey = action.config.peopleColumnKey;
    if (peopleKey !== undefined) {
      const cell = item.values[peopleKey] as { personIds?: unknown } | undefined;
      if (Array.isArray(cell?.personIds)) cell.personIds.forEach((id) => recipients.add(String(id)));
    }
    for (const userId of recipients) {
      const [created] = await this.runner.tx
        .insert(notifications)
        .values({
          tenantId: user.tenantId,
          userId,
          type: 'ai_agent',
          title: action.config.message,
          boardId: item.boardId,
          itemId: item.id,
          entityType: 'ai_agent',
        })
        .returning({ id: notifications.id });
      if (created === undefined) continue;
      await this.events.emit({
        tenantId: user.tenantId,
        type: 'notification.created',
        aggregateType: 'notification',
        aggregateId: created.id,
        userId,
        payload: { notificationId: created.id, type: 'ai_agent', title: action.config.message, itemId: item.id, boardId: item.boardId },
      });
    }
  }

  private async emitAgentChanged(
    user: AuthPrincipal,
    agent: Pick<AgentRow, 'id' | 'workspaceId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'ai_agent.changed',
      aggregateType: 'ai_agent',
      aggregateId: agent.id,
      payload: { agentId: agent.id, workspaceId: agent.workspaceId, change },
      actorId: user.userId,
    });
  }

  private async emitRunChanged(user: AuthPrincipal, run: RunRow): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'ai_agent_run.changed',
      aggregateType: 'ai_agent_run',
      aggregateId: run.id,
      boardId: run.boardId,
      itemId: run.itemId,
      payload: { runId: run.id, agentId: run.agentId, boardId: run.boardId, itemId: run.itemId, status: run.status },
      actorId: user.userId,
    });
  }

  private async insert(
    user: AuthPrincipal,
    workspaceId: string,
    boardId: string | null,
    input: AiAgentInput,
  ): Promise<AiAgentDto> {
    const config = parseConfig(input);
    const [row] = await this.runner.tx
      .insert(aiAgents)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        boardId,
        name: config.name,
        instructions: config.instructions,
        trigger: config.trigger,
        allowedActions: config.allowedActions,
        isActive: input.isActive ?? true,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar o agente.');
    this.events.recordChange({ action: 'ai_agent.create', entityType: 'ai_agent', entityId: row.id, boardId: row.boardId, after: { name: row.name } });
    await this.emitAgentChanged(user, row, 'created');
    return toAgentDto(row);
  }

  private async lockedAgent(agentId: string): Promise<AgentRow> {
    const [row] = await this.runner.tx.select().from(aiAgents).where(and(eq(aiAgents.id, agentId), isNull(aiAgents.deletedAt)));
    if (row === undefined) throw new NotFoundError('Agente de IA');
    return row;
  }

  private async lockedRun(runId: string): Promise<{ run: RunRow; agent: AgentRow }> {
    const [run] = await this.runner.tx.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId));
    if (run === undefined) throw new NotFoundError('Execução de agente de IA');
    const agent = await this.lockedAgent(run.agentId);
    return { run, agent };
  }

  /** `ai.agents.manage`/`ai.agents.approve` são permissões de escopo WORKSPACE (ver `permissions.ts`)
   * — mesmo para um agente de um board específico, quem decide é quem administra o workspace
   * (um board não herda permissão de escopo workspace como herda as de escopo board). */
  private async assertManage(user: AuthPrincipal, agent: AgentRow): Promise<void> {
    await this.access.assert(user, 'ai.agents.manage', { type: 'workspace', id: agent.workspaceId }, 'Agente de IA');
  }

  private async assertApprove(user: AuthPrincipal, agent: AgentRow): Promise<void> {
    await this.access.assert(user, 'ai.agents.approve', { type: 'workspace', id: agent.workspaceId }, 'Agente de IA');
  }
}
