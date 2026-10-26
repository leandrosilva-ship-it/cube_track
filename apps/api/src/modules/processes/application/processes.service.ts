import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, positionBetween } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { pipes, phases, phaseTransitionRules, boards, groups } = schema;

type PipeRow = typeof pipes.$inferSelect;
type PhaseRow = typeof phases.$inferSelect;
type TransitionRuleRow = typeof phaseTransitionRules.$inferSelect;

export interface PipeDto {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PhaseDto {
  id: string;
  pipeId: string;
  groupId: string;
  name: string;
  description: string | null;
  kind: PhaseRow['kind'];
  requiredColumnKeys: string[];
  formId: string | null;
  wipLimit: number | null;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionRuleDto {
  id: string;
  pipeId: string;
  fromPhaseId: string | null;
  toPhaseId: string;
  conditions: Record<string, unknown> | null;
  requiredColumnKeys: string[];
  allowedRoleIds: string[];
  requiresApproval: boolean;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessConfigDto {
  pipe: PipeDto | null;
  phases: PhaseDto[];
  transitionRules: TransitionRuleDto[];
}

export interface CreatePipeInput {
  name: string;
  description?: string | null | undefined;
}

export interface UpdatePipeInput {
  name?: string | undefined;
  description?: string | null | undefined;
  settings?: Record<string, unknown> | undefined;
}

export interface CreatePhaseInput {
  name: string;
  description?: string | null | undefined;
  kind?: PhaseRow['kind'] | undefined;
  requiredColumnKeys?: string[] | undefined;
  formId?: string | null | undefined;
  wipLimit?: number | null | undefined;
  position?: { afterId?: string | undefined; beforeId?: string | undefined } | undefined;
}

export interface UpdatePhaseInput {
  name?: string | undefined;
  description?: string | null | undefined;
  kind?: PhaseRow['kind'] | undefined;
  requiredColumnKeys?: string[] | undefined;
  formId?: string | null | undefined;
  wipLimit?: number | null | undefined;
  position?: { afterId?: string | undefined; beforeId?: string | undefined } | undefined;
}

export interface TransitionRuleInput {
  fromPhaseId?: string | null | undefined;
  toPhaseId: string;
  conditions?: Record<string, unknown> | null | undefined;
  requiredColumnKeys?: string[] | undefined;
  allowedRoleIds?: string[] | undefined;
  requiresApproval?: boolean | undefined;
  isEnabled?: boolean | undefined;
}

export interface UpdateTransitionRuleInput {
  fromPhaseId?: string | null | undefined;
  toPhaseId?: string | undefined;
  conditions?: Record<string, unknown> | null | undefined;
  requiredColumnKeys?: string[] | undefined;
  allowedRoleIds?: string[] | undefined;
  requiresApproval?: boolean | undefined;
  isEnabled?: boolean | undefined;
}

function toPipeDto(row: PipeRow): PipeDto {
  return {
    id: row.id,
    boardId: row.boardId,
    name: row.name,
    description: row.description,
    settings: row.settings,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPhaseDto(row: PhaseRow): PhaseDto {
  return {
    id: row.id,
    pipeId: row.pipeId,
    groupId: row.groupId,
    name: row.name,
    description: row.description,
    kind: row.kind,
    requiredColumnKeys: row.requiredColumnKeys,
    formId: row.formId,
    wipLimit: row.wipLimit,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTransitionRuleDto(row: TransitionRuleRow): TransitionRuleDto {
  return {
    id: row.id,
    pipeId: row.pipeId,
    fromPhaseId: row.fromPhaseId,
    toPhaseId: row.toPhaseId,
    conditions: row.conditions,
    requiredColumnKeys: row.requiredColumnKeys,
    allowedRoleIds: row.allowedRoleIds,
    requiresApproval: row.requiresApproval,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Processos (ADR 0051, estilo Pipefy): pipe de um board `kind: 'process'`, suas fases (1:1 com um
 * grupo do board) e as regras de transição entre fases. CRUD exige `process.manage`; a leitura
 * combinada (config do Kanban/processo) exige apenas `board.read`.
 */
@Injectable()
export class ProcessesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async config(user: AuthPrincipal, boardId: string): Promise<ProcessConfigDto> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const [pipe] = await tx
      .select()
      .from(pipes)
      .where(and(eq(pipes.boardId, boardId), isNull(pipes.deletedAt)));
    if (pipe === undefined) return { pipe: null, phases: [], transitionRules: [] };
    const phaseRows = await tx
      .select()
      .from(phases)
      .where(and(eq(phases.pipeId, pipe.id), isNull(phases.deletedAt)))
      .orderBy(asc(phases.position));
    const ruleRows = await tx
      .select()
      .from(phaseTransitionRules)
      .where(eq(phaseTransitionRules.pipeId, pipe.id));
    return {
      pipe: toPipeDto(pipe),
      phases: phaseRows.map(toPhaseDto),
      transitionRules: ruleRows.map(toTransitionRuleDto),
    };
  }

  async createPipe(
    user: AuthPrincipal,
    boardId: string,
    input: CreatePipeInput,
  ): Promise<PipeDto> {
    await this.access.assert(user, 'process.manage', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const [board] = await tx.select({ kind: boards.kind }).from(boards).where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    if (board.kind !== 'process')
      throw new UnprocessableError(
        'O board precisa ser do tipo Processo para ter um pipe.',
        'board_not_process',
      );
    const [existing] = await tx
      .select({ id: pipes.id })
      .from(pipes)
      .where(and(eq(pipes.boardId, boardId), isNull(pipes.deletedAt)));
    if (existing !== undefined) throw new ConflictError('Este board já tem um pipe.');
    const [row] = await tx
      .insert(pipes)
      .values({
        tenantId: user.tenantId,
        boardId,
        name: input.name,
        description: input.description ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar pipe');
    this.events.recordChange({
      action: 'pipe.created',
      entityType: 'pipe',
      entityId: row.id,
      boardId,
      after: { name: row.name },
    });
    await this.emitConfigChanged(user, boardId, 'pipe_created');
    return toPipeDto(row);
  }

  async updatePipe(user: AuthPrincipal, pipeId: string, input: UpdatePipeInput): Promise<PipeDto> {
    const existing = await this.lockedPipe(pipeId);
    await this.access.assert(
      user,
      'process.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    const [row] = await this.runner.tx
      .update(pipes)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        settings: input.settings ?? existing.settings,
        updatedAt: new Date(),
      })
      .where(eq(pipes.id, pipeId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar pipe');
    this.events.recordChange({
      action: 'pipe.updated',
      entityType: 'pipe',
      entityId: row.id,
      boardId: row.boardId,
      before: { name: existing.name },
      after: { name: row.name },
    });
    await this.emitConfigChanged(user, row.boardId, 'pipe_updated');
    return toPipeDto(row);
  }

  async removePipe(user: AuthPrincipal, pipeId: string): Promise<void> {
    const existing = await this.lockedPipe(pipeId);
    await this.access.assert(
      user,
      'process.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    const tx = this.runner.tx;
    await tx.delete(phaseTransitionRules).where(eq(phaseTransitionRules.pipeId, pipeId));
    await tx.update(phases).set({ deletedAt: new Date() }).where(eq(phases.pipeId, pipeId));
    await tx.update(pipes).set({ deletedAt: new Date() }).where(eq(pipes.id, pipeId));
    this.events.recordChange({
      action: 'pipe.deleted',
      entityType: 'pipe',
      entityId: pipeId,
      boardId: existing.boardId,
      before: { name: existing.name },
    });
    await this.emitConfigChanged(user, existing.boardId, 'pipe_deleted');
  }

  // ---------------------------------------------------------------------------------- fases ---

  async createPhase(
    user: AuthPrincipal,
    pipeId: string,
    input: CreatePhaseInput,
  ): Promise<PhaseDto> {
    const pipe = await this.lockedPipe(pipeId);
    await this.access.assert(user, 'process.manage', { type: 'board', id: pipe.boardId }, 'Board');
    const tx = this.runner.tx;
    const groupId = newId();
    const groupPosition = await this.nextGroupPosition(pipe.boardId);
    await tx.insert(groups).values({
      id: groupId,
      tenantId: user.tenantId,
      boardId: pipe.boardId,
      name: input.name,
      position: groupPosition,
      createdBy: user.userId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'group.changed',
      aggregateType: 'group',
      aggregateId: groupId,
      boardId: pipe.boardId,
      payload: { groupId, change: 'created' },
      actorId: user.userId,
    });
    const phasePosition = await this.nextPhasePosition(pipeId, input.position);
    const [row] = await tx
      .insert(phases)
      .values({
        tenantId: user.tenantId,
        pipeId,
        groupId,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind ?? 'intermediate',
        requiredColumnKeys: input.requiredColumnKeys ?? [],
        formId: input.formId ?? null,
        wipLimit: input.wipLimit ?? null,
        position: phasePosition,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar fase');
    this.events.recordChange({
      action: 'phase.created',
      entityType: 'phase',
      entityId: row.id,
      boardId: pipe.boardId,
      after: { name: row.name, groupId },
    });
    await this.emitPhaseChanged(user, row, 'created');
    return toPhaseDto(row);
  }

  async updatePhase(
    user: AuthPrincipal,
    phaseId: string,
    input: UpdatePhaseInput,
  ): Promise<PhaseDto> {
    const existing = await this.lockedPhase(phaseId);
    const pipe = await this.lockedPipe(existing.pipeId);
    await this.access.assert(user, 'process.manage', { type: 'board', id: pipe.boardId }, 'Board');
    const tx = this.runner.tx;
    const position =
      input.position === undefined
        ? existing.position
        : await this.nextPhasePosition(existing.pipeId, input.position, phaseId);
    const [row] = await tx
      .update(phases)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        kind: input.kind ?? existing.kind,
        requiredColumnKeys: input.requiredColumnKeys ?? existing.requiredColumnKeys,
        formId: input.formId === undefined ? existing.formId : input.formId,
        wipLimit: input.wipLimit === undefined ? existing.wipLimit : input.wipLimit,
        position,
        updatedAt: new Date(),
      })
      .where(eq(phases.id, phaseId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar fase');
    if (input.name !== undefined && input.name !== existing.name) {
      await tx.update(groups).set({ name: input.name }).where(eq(groups.id, existing.groupId));
      await this.events.emit({
        tenantId: user.tenantId,
        type: 'group.changed',
        aggregateType: 'group',
        aggregateId: existing.groupId,
        boardId: pipe.boardId,
        payload: { groupId: existing.groupId, change: 'updated' },
        actorId: user.userId,
      });
    }
    this.events.recordChange({
      action: 'phase.updated',
      entityType: 'phase',
      entityId: row.id,
      boardId: pipe.boardId,
      before: { name: existing.name, position: existing.position },
      after: { name: row.name, position: row.position },
    });
    await this.emitPhaseChanged(user, row, position === existing.position ? 'updated' : 'reordered');
    return toPhaseDto(row);
  }

  async removePhase(user: AuthPrincipal, phaseId: string): Promise<void> {
    const existing = await this.lockedPhase(phaseId);
    const pipe = await this.lockedPipe(existing.pipeId);
    await this.access.assert(user, 'process.manage', { type: 'board', id: pipe.boardId }, 'Board');
    const tx = this.runner.tx;
    await tx
      .delete(phaseTransitionRules)
      .where(
        and(
          eq(phaseTransitionRules.pipeId, existing.pipeId),
          eq(phaseTransitionRules.toPhaseId, phaseId),
        ),
      );
    await tx
      .delete(phaseTransitionRules)
      .where(
        and(
          eq(phaseTransitionRules.pipeId, existing.pipeId),
          eq(phaseTransitionRules.fromPhaseId, phaseId),
        ),
      );
    await tx.update(phases).set({ deletedAt: new Date() }).where(eq(phases.id, phaseId));
    this.events.recordChange({
      action: 'phase.deleted',
      entityType: 'phase',
      entityId: phaseId,
      boardId: pipe.boardId,
      before: { name: existing.name },
    });
    await this.emitPhaseChanged(user, existing, 'deleted');
  }

  // ------------------------------------------------------------------------ regras de transição ---

  async createTransitionRule(
    user: AuthPrincipal,
    pipeId: string,
    input: TransitionRuleInput,
  ): Promise<TransitionRuleDto> {
    const pipe = await this.lockedPipe(pipeId);
    await this.access.assert(user, 'process.manage', { type: 'board', id: pipe.boardId }, 'Board');
    await this.assertPhasesBelongToPipe(pipeId, [input.fromPhaseId ?? null, input.toPhaseId]);
    const [row] = await this.runner.tx
      .insert(phaseTransitionRules)
      .values({
        tenantId: user.tenantId,
        pipeId,
        fromPhaseId: input.fromPhaseId ?? null,
        toPhaseId: input.toPhaseId,
        conditions: input.conditions ?? null,
        requiredColumnKeys: input.requiredColumnKeys ?? [],
        allowedRoleIds: input.allowedRoleIds ?? [],
        requiresApproval: input.requiresApproval ?? false,
        isEnabled: input.isEnabled ?? true,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar regra de transição');
    this.events.recordChange({
      action: 'phase_transition_rule.created',
      entityType: 'phase_transition_rule',
      entityId: row.id,
      boardId: pipe.boardId,
      after: { fromPhaseId: row.fromPhaseId, toPhaseId: row.toPhaseId },
    });
    await this.emitConfigChanged(user, pipe.boardId, 'transition_rule_created');
    return toTransitionRuleDto(row);
  }

  async updateTransitionRule(
    user: AuthPrincipal,
    ruleId: string,
    input: UpdateTransitionRuleInput,
  ): Promise<TransitionRuleDto> {
    const existing = await this.lockedTransitionRule(ruleId);
    const pipe = await this.lockedPipe(existing.pipeId);
    await this.access.assert(user, 'process.manage', { type: 'board', id: pipe.boardId }, 'Board');
    if (input.fromPhaseId !== undefined || input.toPhaseId !== undefined) {
      await this.assertPhasesBelongToPipe(existing.pipeId, [
        input.fromPhaseId === undefined ? existing.fromPhaseId : input.fromPhaseId,
        input.toPhaseId ?? existing.toPhaseId,
      ]);
    }
    const [row] = await this.runner.tx
      .update(phaseTransitionRules)
      .set({
        fromPhaseId: input.fromPhaseId === undefined ? existing.fromPhaseId : input.fromPhaseId,
        toPhaseId: input.toPhaseId ?? existing.toPhaseId,
        conditions: input.conditions === undefined ? existing.conditions : input.conditions,
        requiredColumnKeys: input.requiredColumnKeys ?? existing.requiredColumnKeys,
        allowedRoleIds: input.allowedRoleIds ?? existing.allowedRoleIds,
        requiresApproval: input.requiresApproval ?? existing.requiresApproval,
        isEnabled: input.isEnabled ?? existing.isEnabled,
        updatedAt: new Date(),
      })
      .where(eq(phaseTransitionRules.id, ruleId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar regra de transição');
    this.events.recordChange({
      action: 'phase_transition_rule.updated',
      entityType: 'phase_transition_rule',
      entityId: row.id,
      boardId: pipe.boardId,
      before: { isEnabled: existing.isEnabled },
      after: { isEnabled: row.isEnabled },
    });
    await this.emitConfigChanged(user, pipe.boardId, 'transition_rule_updated');
    return toTransitionRuleDto(row);
  }

  async removeTransitionRule(user: AuthPrincipal, ruleId: string): Promise<void> {
    const existing = await this.lockedTransitionRule(ruleId);
    const pipe = await this.lockedPipe(existing.pipeId);
    await this.access.assert(user, 'process.manage', { type: 'board', id: pipe.boardId }, 'Board');
    await this.runner.tx
      .delete(phaseTransitionRules)
      .where(eq(phaseTransitionRules.id, ruleId));
    this.events.recordChange({
      action: 'phase_transition_rule.deleted',
      entityType: 'phase_transition_rule',
      entityId: ruleId,
      boardId: pipe.boardId,
    });
    await this.emitConfigChanged(user, pipe.boardId, 'transition_rule_deleted');
  }

  // ------------------------------------------------------------------------------- internos ---

  private async emitPhaseChanged(
    user: AuthPrincipal,
    phase: PhaseRow,
    change: 'created' | 'updated' | 'deleted' | 'reordered',
  ): Promise<void> {
    const pipe = await this.lockedPipe(phase.pipeId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'phase.changed',
      aggregateType: 'phase',
      aggregateId: phase.id,
      boardId: pipe.boardId,
      payload: { phaseId: phase.id, boardId: pipe.boardId, change },
      actorId: user.userId,
    });
  }

  private async emitConfigChanged(
    user: AuthPrincipal,
    boardId: string,
    change:
      | 'pipe_created'
      | 'pipe_updated'
      | 'pipe_deleted'
      | 'transition_rule_created'
      | 'transition_rule_updated'
      | 'transition_rule_deleted'
      | 'sla_created'
      | 'sla_updated'
      | 'sla_deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'process_config.changed',
      aggregateType: 'board',
      aggregateId: boardId,
      boardId,
      payload: { boardId, change },
      actorId: user.userId,
    });
  }

  private async nextGroupPosition(boardId: string): Promise<string> {
    const [last] = await this.runner.tx
      .select({ position: groups.position })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.position));
    return positionBetween(last?.position ?? null, null);
  }

  private async nextPhasePosition(
    pipeId: string,
    requested: { afterId?: string | undefined; beforeId?: string | undefined } | undefined,
    excludeId?: string,
  ): Promise<string> {
    const rows = await this.runner.tx
      .select({ id: phases.id, position: phases.position })
      .from(phases)
      .where(and(eq(phases.pipeId, pipeId), isNull(phases.deletedAt)))
      .orderBy(asc(phases.position));
    const siblings = rows.filter((row) => row.id !== excludeId);
    if (requested === undefined) {
      return positionBetween(siblings.at(-1)?.position ?? null, null);
    }
    const afterIndex = siblings.findIndex((row) => row.id === requested.afterId);
    const beforeIndex = siblings.findIndex((row) => row.id === requested.beforeId);
    if (requested.afterId !== undefined && afterIndex >= 0) {
      return positionBetween(siblings[afterIndex]?.position ?? null, siblings[afterIndex + 1]?.position ?? null);
    }
    if (requested.beforeId !== undefined && beforeIndex >= 0) {
      return positionBetween(siblings[beforeIndex - 1]?.position ?? null, siblings[beforeIndex]?.position ?? null);
    }
    return positionBetween(siblings.at(-1)?.position ?? null, null);
  }

  private async assertPhasesBelongToPipe(
    pipeId: string,
    phaseIds: (string | null)[],
  ): Promise<void> {
    const ids = [...new Set(phaseIds.filter((id): id is string => id !== null))];
    if (ids.length === 0) return;
    const rows = await this.runner.tx
      .select({ id: phases.id })
      .from(phases)
      .where(and(eq(phases.pipeId, pipeId), isNull(phases.deletedAt)));
    const known = new Set(rows.map((row) => row.id));
    if (!ids.every((id) => known.has(id)))
      throw new UnprocessableError('Fase não pertence a este pipe.', 'phase_not_in_pipe');
  }

  private async lockedPipe(pipeId: string): Promise<PipeRow> {
    const [row] = await this.runner.tx
      .select()
      .from(pipes)
      .where(and(eq(pipes.id, pipeId), isNull(pipes.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Pipe');
    return row;
  }

  private async lockedPhase(phaseId: string): Promise<PhaseRow> {
    const [row] = await this.runner.tx
      .select()
      .from(phases)
      .where(and(eq(phases.id, phaseId), isNull(phases.deletedAt)))
      .for('update');
    if (row === undefined) throw new NotFoundError('Fase');
    return row;
  }

  private async lockedTransitionRule(ruleId: string): Promise<TransitionRuleRow> {
    const [row] = await this.runner.tx
      .select()
      .from(phaseTransitionRules)
      .where(eq(phaseTransitionRules.id, ruleId))
      .for('update');
    if (row === undefined) throw new NotFoundError('Regra de transição');
    return row;
  }
}
