import { Injectable } from '@nestjs/common';
import { loadWorkingCalendar, schema, type Transaction } from '@cube-track/db';
import { addBusinessMinutes, evaluateConditions, isEmptyValue, type WorkHoursCalendar } from '@cube-track/shared';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, UnprocessableError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import type { ItemRecord } from '../domain/item.js';

const { boards, phases, phaseTransitionRules, pipes, slas, slaTrackers, slaEvents, approvalRequests, workCalendars } =
  schema;

type PhaseRow = typeof phases.$inferSelect;

export interface PhaseFieldUpdate {
  phaseId: string | null;
  phaseEnteredAt: Date | null;
}

/** Visão plana dos campos do item (nativos + valores de coluna), para `requiredColumnKeys`/`conditions`. */
interface ItemSnapshotLike {
  name: string;
  groupId: string;
  values: Record<string, Record<string, unknown>>;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  progress: string | null;
}

function flatFields(snapshot: ItemSnapshotLike): Record<string, unknown> {
  return {
    ...snapshot.values,
    name: snapshot.name,
    groupId: snapshot.groupId,
    plannedStartDate: snapshot.plannedStartDate,
    plannedEndDate: snapshot.plannedEndDate,
    replannedStartDate: snapshot.replannedStartDate,
    replannedEndDate: snapshot.replannedEndDate,
    actualStartDate: snapshot.actualStartDate,
    actualEndDate: snapshot.actualEndDate,
    progress: snapshot.progress,
  };
}

/**
 * Transição de fase de um board `kind: 'process'` (ADR 0051): ao mover um item de grupo, valida a
 * regra de transição aplicável (papel permitido, colunas obrigatórias, condições, aprovação — via o
 * módulo de aprovações do Prompt 7) e conduz o ciclo de vida do `sla_tracker` (encerra o da fase que
 * o item deixou, inicia o da fase em que entrou). Chamado por `ItemWriter.update` só em escritas de
 * usuário (`checkPermissions`); automações e o sistema movem itens sem passar por este portão.
 */
@Injectable()
export class PhaseTransitionGuard {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  /** Fase do grupo de destino (sem validar regra) — uso na criação direta do item nesse grupo. */
  async resolvePhaseForGroup(groupId: string): Promise<PhaseFieldUpdate> {
    const [phase] = await this.runner.tx
      .select()
      .from(phases)
      .where(and(eq(phases.groupId, groupId), isNull(phases.deletedAt)));
    if (phase === undefined) return { phaseId: null, phaseEnteredAt: null };
    return { phaseId: phase.id, phaseEnteredAt: new Date() };
  }

  /** Inicia os trackers de SLA da fase para um item recém-criado já dentro dela. */
  async startTrackersForNewItem(
    user: AuthPrincipal,
    item: ItemRecord,
    phaseId: string,
    boardId: string,
  ): Promise<void> {
    const [phase] = await this.runner.tx.select().from(phases).where(eq(phases.id, phaseId));
    if (phase === undefined) return;
    await this.openTrackers(user, item, phase, boardId);
  }

  async apply(
    user: AuthPrincipal,
    item: ItemRecord,
    targetGroupId: string,
    nextSnapshot: ItemSnapshotLike,
  ): Promise<PhaseFieldUpdate | null> {
    const tx = this.runner.tx;
    const [targetPhase] = await tx
      .select()
      .from(phases)
      .where(and(eq(phases.groupId, targetGroupId), isNull(phases.deletedAt)));

    if (targetPhase === undefined) {
      if (item.phaseId === null) return null;
      await this.closeTrackers(user, item, item.phaseId);
      return { phaseId: null, phaseEnteredAt: null };
    }
    if (targetPhase.id === item.phaseId) return null;

    const [pipe] = await tx.select().from(pipes).where(eq(pipes.id, targetPhase.pipeId));
    if (pipe === undefined) return null;

    const rule = await this.findRule(targetPhase.pipeId, item.phaseId, targetPhase.id);
    if (rule?.isEnabled === true) {
      await this.assertRule(user, item, flatFields(nextSnapshot), pipe.boardId, rule);
    }

    if (item.phaseId !== null) await this.closeTrackers(user, item, item.phaseId);
    await this.openTrackers(user, item, targetPhase, pipe.boardId);

    return { phaseId: targetPhase.id, phaseEnteredAt: new Date() };
  }

  private async findRule(
    pipeId: string,
    fromPhaseId: string | null,
    toPhaseId: string,
  ): Promise<typeof phaseTransitionRules.$inferSelect | undefined> {
    const rows = await this.runner.tx
      .select()
      .from(phaseTransitionRules)
      .where(
        and(eq(phaseTransitionRules.pipeId, pipeId), eq(phaseTransitionRules.toPhaseId, toPhaseId)),
      );
    const specific =
      fromPhaseId === null ? undefined : rows.find((row) => row.fromPhaseId === fromPhaseId);
    return specific ?? rows.find((row) => row.fromPhaseId === null);
  }

  private async assertRule(
    user: AuthPrincipal,
    item: ItemRecord,
    fields: Readonly<Record<string, unknown>>,
    boardId: string,
    rule: typeof phaseTransitionRules.$inferSelect,
  ): Promise<void> {
    const missing = rule.requiredColumnKeys.filter((key) => isEmptyValue(fields[key]));
    if (missing.length > 0) {
      throw new UnprocessableError(
        'Preencha os campos obrigatórios desta transição antes de mover o item.',
        'transition_required_fields',
        { fields: missing },
      );
    }
    if (rule.allowedRoleIds.length > 0) {
      const boardAccess = await this.access.board(user, boardId);
      const hasRole =
        boardAccess !== null && rule.allowedRoleIds.some((id) => boardAccess.roleIds.includes(id));
      const canOverride = await this.access.can(user, 'board.manage', { type: 'board', id: boardId });
      if (!hasRole && !canOverride) {
        throw new ForbiddenError(
          'Seu papel não pode executar esta transição.',
          'transition_role_forbidden',
        );
      }
    }
    if (!evaluateConditions(rule.conditions, fields)) {
      throw new UnprocessableError(
        'As condições desta transição não foram atendidas.',
        'transition_conditions_not_met',
      );
    }
    if (rule.requiresApproval) {
      const conditions = [
        eq(approvalRequests.itemId, item.id),
        eq(approvalRequests.status, 'approved' as const),
      ];
      if (item.phaseEnteredAt !== null)
        conditions.push(gt(approvalRequests.resolvedAt, item.phaseEnteredAt));
      const [approved] = await this.runner.tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(...conditions));
      if (approved === undefined) {
        throw new UnprocessableError(
          'Esta transição exige um pedido de aprovação aprovado; solicite aprovação antes de mover.',
          'transition_requires_approval',
        );
      }
    }
  }

  /** Encerra os trackers da fase deixada: `met` se dentro do prazo, `breached` se já vencido. */
  private async closeTrackers(
    user: AuthPrincipal,
    item: ItemRecord,
    oldPhaseId: string,
  ): Promise<void> {
    const tx = this.runner.tx;
    const rows = await tx
      .select({ tracker: slaTrackers, slaId: slas.id })
      .from(slaTrackers)
      .innerJoin(slas, eq(slas.id, slaTrackers.slaId))
      .where(
        and(
          eq(slaTrackers.itemId, item.id),
          eq(slas.phaseId, oldPhaseId),
          inArray(slaTrackers.status, ['running', 'paused']),
        ),
      );
    const now = new Date();
    for (const { tracker, slaId } of rows) {
      const status = now.getTime() <= tracker.dueAt.getTime() ? 'met' : 'breached';
      await tx
        .update(slaTrackers)
        .set({ status, completedAt: now })
        .where(eq(slaTrackers.id, tracker.id));
      const elapsedMinutes = Math.round((now.getTime() - tracker.startedAt.getTime()) / 60_000);
      await tx.insert(slaEvents).values({
        tenantId: user.tenantId,
        slaId,
        trackerId: tracker.id,
        itemId: item.id,
        type: status,
        elapsedMinutes,
      });
      await this.events.emit({
        tenantId: user.tenantId,
        type: 'sla.changed',
        aggregateType: 'sla_tracker',
        aggregateId: tracker.id,
        boardId: item.boardId,
        itemId: item.id,
        payload: { trackerId: tracker.id, itemId: item.id, boardId: item.boardId, status },
        actorId: user.userId,
      });
    }
  }

  /** Inicia um tracker para cada SLA habilitado da fase (apenas SLAs por fase — ADR 0051, escopo). */
  private async openTrackers(
    user: AuthPrincipal,
    item: ItemRecord,
    phase: PhaseRow,
    boardId: string,
  ): Promise<void> {
    const tx = this.runner.tx;
    const rows = await tx
      .select()
      .from(slas)
      .where(and(eq(slas.phaseId, phase.id), eq(slas.isEnabled, true), isNull(slas.deletedAt)));
    if (rows.length === 0) return;
    const now = new Date();
    const calendar = await this.calendarOf(user.tenantId, boardId);
    for (const sla of rows) {
      const dueAt = sla.useBusinessTime
        ? addBusinessMinutes(now, sla.targetMinutes, calendar)
        : new Date(now.getTime() + sla.targetMinutes * 60_000);
      const warningAt = new Date(
        now.getTime() + (dueAt.getTime() - now.getTime()) * (sla.warningPercent / 100),
      );
      const [tracker] = await tx
        .insert(slaTrackers)
        .values({
          tenantId: user.tenantId,
          slaId: sla.id,
          itemId: item.id,
          status: 'running',
          startedAt: now,
          dueAt,
          warningAt,
        })
        .returning();
      if (tracker === undefined) continue;
      await tx.insert(slaEvents).values({
        tenantId: user.tenantId,
        slaId: sla.id,
        trackerId: tracker.id,
        itemId: item.id,
        type: 'started',
      });
      await this.events.emit({
        tenantId: user.tenantId,
        type: 'sla.changed',
        aggregateType: 'sla_tracker',
        aggregateId: tracker.id,
        boardId,
        itemId: item.id,
        payload: { trackerId: tracker.id, itemId: item.id, boardId, status: 'running' },
        actorId: user.userId,
      });
    }
  }

  /** Calendário de horas úteis do board (próprio ou padrão do tenant), com feriados resolvidos. */
  private async calendarOf(tenantId: string, boardId: string): Promise<WorkHoursCalendar> {
    const tx: Transaction = this.runner.tx;
    const [board] = await tx
      .select({ calendarId: boards.workCalendarId })
      .from(boards)
      .where(eq(boards.id, boardId));
    const calendarId = board?.calendarId ?? null;
    const calendarFilter =
      calendarId === null
        ? and(eq(workCalendars.isDefault, true), isNull(workCalendars.deletedAt))
        : and(eq(workCalendars.id, calendarId), isNull(workCalendars.deletedAt));
    const [calendar] = await tx.select().from(workCalendars).where(calendarFilter).limit(1);
    const today = new Date().toISOString().slice(0, 10);
    const working = await loadWorkingCalendar(tx, tenantId, boardId, today);
    return {
      workingDays: working.workingDays,
      holidays: working.holidays,
      workStart: calendar?.workStart ?? '09:00',
      workEnd: calendar?.workEnd ?? '18:00',
      timeZone: calendar?.timezone ?? 'America/Sao_Paulo',
    };
  }
}
