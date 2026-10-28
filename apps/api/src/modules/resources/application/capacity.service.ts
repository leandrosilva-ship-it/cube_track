import { Injectable } from '@nestjs/common';
import {
  aggregateCapacityDays,
  businessDaysBetween,
  dailyCapacity,
  monthlyBuckets,
  suggestLeveling,
  type AbsencePeriod,
  type AllocationPeriod,
  type CapacityBucket,
  type ForecastBucket,
  type LevelingSuggestion,
} from '@cube-track/shared';
import { loadPersonWorkingCalendar, schema } from '@cube-track/db';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { loadProfileOrDefault } from './resource-profiles.service.js';
import { primaryWorkspaceId } from './workspace-scope.js';

const { absences, allocations, memberships, resourceRequests, teamMembers, userSkills, users } = schema;

export interface ResourceScopeQuery {
  from: string;
  to: string;
  userIds?: readonly string[] | undefined;
  teamIds?: readonly string[] | undefined;
  skillId?: string | undefined;
  boardId?: string | undefined;
}

export interface HeatmapRow {
  userId: string;
  userName: string;
  teamIds: string[];
  skillIds: string[];
  buckets: CapacityBucket[];
}

export interface HeatmapResult {
  from: string;
  to: string;
  granularity: 'day' | 'week' | 'month';
  rows: HeatmapRow[];
}

function daysOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end < start) return 0;
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Motor de capacidade (ADR 0052): heatmap disponível × alocado, sugestão de nivelamento, simulação
 * what-if e previsão de demanda × capacidade. Nunca expõe `costRateHour`/`billRateHour` (dado de
 * compensação) — só o necessário para montar o heatmap e as sugestões.
 */
@Injectable()
export class CapacityService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
  ) {}

  async heatmap(
    user: AuthPrincipal,
    query: ResourceScopeQuery & { granularity?: 'day' | 'week' | 'month' | undefined },
  ): Promise<HeatmapResult> {
    const granularity = query.granularity ?? 'week';
    const userIds = await this.resolveUserIds(user, query);
    await this.assertViewable(user, userIds);
    const rows = await this.rowsFor(user.tenantId, userIds, query.from, query.to, granularity);
    return { from: query.from, to: query.to, granularity, rows };
  }

  /** Sugestões de nivelamento (gulosas) para o escopo informado — nunca grava nada. */
  async levelingSuggestions(user: AuthPrincipal, query: ResourceScopeQuery): Promise<LevelingSuggestion[]> {
    const userIds = await this.resolveUserIds(user, query);
    await this.assertViewable(user, userIds);
    const suggestions: LevelingSuggestion[] = [];
    for (const userId of userIds) {
      const { days, allocationPeriods } = await this.dailyFor(user.tenantId, userId, query.from, query.to, []);
      suggestions.push(
        ...suggestLeveling({ from: query.from, to: query.to, days, allocations: allocationPeriods }),
      );
    }
    return suggestions;
  }

  /**
   * Simulação what-if: recalcula a capacidade de uma pessoa somando alocações hipotéticas às reais,
   * sem gravar nada no banco — resposta descartável, só para visualização.
   */
  async whatIf(
    user: AuthPrincipal,
    query: {
      from: string;
      to: string;
      userId: string;
      granularity?: 'day' | 'week' | 'month' | undefined;
      hypotheticalAllocations: readonly { startDate: string; endDate: string; hoursPerDay: string }[];
    },
  ): Promise<{ real: CapacityBucket[]; simulated: CapacityBucket[] }> {
    await this.assertViewable(user, [query.userId]);
    const granularity = query.granularity ?? 'week';
    const hypothetical: AllocationPeriod[] = query.hypotheticalAllocations.map((entry, index) => ({
      id: `hypothetical-${index}`,
      userId: query.userId,
      startDate: entry.startDate,
      endDate: entry.endDate,
      hoursPerDay: Number(entry.hoursPerDay),
    }));
    const real = await this.dailyFor(user.tenantId, query.userId, query.from, query.to, []);
    const simulated = await this.dailyFor(user.tenantId, query.userId, query.from, query.to, hypothetical);
    return {
      real: aggregateCapacityDays(real.days, granularity),
      simulated: aggregateCapacityDays(simulated.days, granularity),
    };
  }

  /** Previsão de demanda × capacidade do tenant inteiro, em baldes mensais (3/6/12 meses). */
  async forecast(user: AuthPrincipal, months: 3 | 6 | 12): Promise<ForecastBucket[]> {
    await this.assertManage(user);
    const buckets = monthlyBuckets(new Date().toISOString().slice(0, 10), months);
    const from = buckets[0]?.start ?? new Date().toISOString().slice(0, 10);
    const to = buckets.at(-1)?.end ?? from;

    const memberRows = await this.runner.tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, user.tenantId), eq(memberships.status, 'active')));
    const userIds = memberRows.map((row) => row.userId);

    const allocationRows =
      userIds.length === 0
        ? []
        : await this.runner.tx
            .select()
            .from(allocations)
            .where(
              and(
                isNull(allocations.deletedAt),
                gte(allocations.endDate, from),
                lte(allocations.startDate, to),
                inArray(allocations.userId, userIds),
              ),
            );
    const requestRows = await this.runner.tx
      .select()
      .from(resourceRequests)
      .where(
        and(eq(resourceRequests.status, 'open'), gte(resourceRequests.endDate, from), lte(resourceRequests.startDate, to)),
      );

    const result: ForecastBucket[] = [];
    for (const bucket of buckets) {
      let capacityHours = 0;
      for (const userId of userIds) {
        const profile = await loadProfileOrDefault(this.runner.tx, userId);
        const calendar = await loadPersonWorkingCalendar(this.runner.tx, user.tenantId, userId, bucket.start);
        const dailyHours = Number(profile.capacityHoursPerWeek) / Math.max(1, calendar.workingDays.length);
        const [approvedAbsences] = await Promise.all([
          this.runner.tx
            .select()
            .from(absences)
            .where(
              and(
                eq(absences.userId, userId),
                eq(absences.status, 'approved'),
                isNull(absences.deletedAt),
                gte(absences.endDate, bucket.start),
                lte(absences.startDate, bucket.end),
              ),
            ),
        ]);
        const businessDays = businessDaysBetween(bucket.start, bucket.end, calendar);
        let nominal = dailyHours * businessDays;
        for (const absence of approvedAbsences) {
          const overlap = daysOverlap(absence.startDate, absence.endDate, bucket.start, bucket.end);
          nominal -= overlap * (absence.hoursPerDay === null ? dailyHours : Number(absence.hoursPerDay));
        }
        capacityHours += Math.max(0, nominal);
      }

      let demandHours = 0;
      for (const allocation of allocationRows) {
        const overlap = daysOverlap(allocation.startDate, allocation.endDate, bucket.start, bucket.end);
        if (overlap > 0) demandHours += overlap * Number(allocation.hoursPerDay);
      }
      for (const request of requestRows) {
        const overlap = daysOverlap(request.startDate, request.endDate, bucket.start, bucket.end);
        const total = daysBetween(request.startDate, request.endDate);
        if (overlap > 0 && total > 0) demandHours += (Number(request.hours) * overlap) / total;
      }

      result.push({
        month: bucket.month,
        capacityHours,
        demandHours,
        gapHours: capacityHours - demandHours,
      });
    }
    return result;
  }

  // ------------------------------------------------------------------------------ internos ---

  private async rowsFor(
    tenantId: string,
    userIds: readonly string[],
    from: string,
    to: string,
    granularity: 'day' | 'week' | 'month',
  ): Promise<HeatmapRow[]> {
    if (userIds.length === 0) return [];
    const [userRows, teamRows, skillRows] = await Promise.all([
      this.runner.tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...userIds])),
      this.runner.tx
        .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(inArray(teamMembers.userId, [...userIds])),
      this.runner.tx
        .select({ userId: userSkills.userId, skillId: userSkills.skillId })
        .from(userSkills)
        .where(inArray(userSkills.userId, [...userIds])),
    ]);
    const nameOf = new Map(userRows.map((row) => [row.id, row.name]));
    const teamsOf = new Map<string, string[]>();
    for (const row of teamRows) teamsOf.set(row.userId, [...(teamsOf.get(row.userId) ?? []), row.teamId]);
    const skillsOf = new Map<string, string[]>();
    for (const row of skillRows) skillsOf.set(row.userId, [...(skillsOf.get(row.userId) ?? []), row.skillId]);

    const rows: HeatmapRow[] = [];
    for (const userId of userIds) {
      const { days } = await this.dailyFor(tenantId, userId, from, to, []);
      rows.push({
        userId,
        userName: nameOf.get(userId) ?? userId,
        teamIds: teamsOf.get(userId) ?? [],
        skillIds: skillsOf.get(userId) ?? [],
        buckets: aggregateCapacityDays(days, granularity),
      });
    }
    return rows;
  }

  private async dailyFor(
    tenantId: string,
    userId: string,
    from: string,
    to: string,
    extraAllocations: readonly AllocationPeriod[],
  ): Promise<{
    days: ReturnType<typeof dailyCapacity>;
    allocationPeriods: AllocationPeriod[];
  }> {
    const profile = await loadProfileOrDefault(this.runner.tx, userId);
    const calendar = await loadPersonWorkingCalendar(this.runner.tx, tenantId, userId, from);
    const hoursPerDay = Number(profile.capacityHoursPerWeek) / Math.max(1, calendar.workingDays.length);

    const [absenceRows, allocationRows] = await Promise.all([
      this.runner.tx
        .select()
        .from(absences)
        .where(
          and(
            eq(absences.userId, userId),
            eq(absences.status, 'approved'),
            isNull(absences.deletedAt),
            gte(absences.endDate, from),
            lte(absences.startDate, to),
          ),
        ),
      this.runner.tx
        .select()
        .from(allocations)
        .where(
          and(
            eq(allocations.userId, userId),
            isNull(allocations.deletedAt),
            gte(allocations.endDate, from),
            lte(allocations.startDate, to),
          ),
        ),
    ]);

    const absencePeriods: AbsencePeriod[] = absenceRows.map((row) => ({
      startDate: row.startDate,
      endDate: row.endDate,
      hoursPerDay: row.hoursPerDay === null ? null : Number(row.hoursPerDay),
    }));
    const allocationPeriods: AllocationPeriod[] = [
      ...allocationRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        startDate: row.startDate,
        endDate: row.endDate,
        hoursPerDay: Number(row.hoursPerDay),
      })),
      ...extraAllocations,
    ];

    const days = dailyCapacity({
      from,
      to,
      calendar,
      hoursPerDay,
      absences: absencePeriods,
      allocations: allocationPeriods,
    });
    return { days, allocationPeriods };
  }

  private async resolveUserIds(user: AuthPrincipal, query: ResourceScopeQuery): Promise<string[]> {
    if (query.userIds !== undefined && query.userIds.length > 0) return [...query.userIds];
    if (query.teamIds !== undefined && query.teamIds.length > 0) {
      const rows = await this.runner.tx
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(inArray(teamMembers.teamId, [...query.teamIds]));
      return [...new Set(rows.map((row) => row.userId))];
    }
    if (query.skillId !== undefined) {
      const rows = await this.runner.tx
        .select({ userId: userSkills.userId })
        .from(userSkills)
        .where(eq(userSkills.skillId, query.skillId));
      return [...new Set(rows.map((row) => row.userId))];
    }
    if (query.boardId !== undefined) {
      const rows = await this.runner.tx
        .select({ userId: allocations.userId })
        .from(allocations)
        .where(
          and(eq(allocations.boardId, query.boardId), isNull(allocations.deletedAt), gte(allocations.endDate, query.from), lte(allocations.startDate, query.to)),
        );
      return [...new Set(rows.map((row) => row.userId))];
    }
    const rows = await this.runner.tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, user.tenantId), eq(memberships.status, 'active')));
    return rows.map((row) => row.userId);
  }

  /** Qualquer pessoa pode ver a própria capacidade; ver a de terceiros exige `resources.manage`/`timesheet.approve`. */
  private async assertViewable(user: AuthPrincipal, userIds: readonly string[]): Promise<void> {
    const onlySelf = userIds.length <= 1 && userIds.every((id) => id === user.userId);
    if (onlySelf) return;
    await this.assertManage(user);
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    const allowed =
      (await this.access.can(user, 'resources.manage', { type: 'workspace', id: workspaceId })) ||
      (await this.access.can(user, 'timesheet.approve', { type: 'workspace', id: workspaceId }));
    if (!allowed) throw new ForbiddenError();
  }
}
