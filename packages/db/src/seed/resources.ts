import { newId } from '@cube-track/shared';

import {
  absences,
  allocations,
  resourceProfiles,
  resourceRequests,
  skills,
  timeEntries,
  timesheetApprovals,
  userSkills,
} from '../schema/index.js';
import { DEMANDS, DEMO_USERS } from './data.js';
import { addBusinessDays, addDays, at } from './random.js';
import { SEED_REFERENCE_DATE, userId, type SeedContext } from './context.js';
import type { PmspBoard } from './pmsp.js';

/** Perfis, competências, alocações, ausências e timesheet de duas semanas. */
export async function seedResources(ctx: SeedContext, pmsp: PmspBoard): Promise<void> {
  const { tx, tenantId, rng } = ctx;
  const createdBy = userId(ctx, 'carlos');
  const staff = DEMO_USERS.filter((user) => user.role !== 'guest');

  await tx.insert(resourceProfiles).values(
    staff.map((user) => ({
      tenantId,
      userId: userId(ctx, user.key),
      jobTitle: user.jobTitle,
      department: user.department,
      managerId:
        user.key === 'ana'
          ? null
          : user.key === 'carlos'
            ? userId(ctx, 'ana')
            : userId(ctx, 'carlos'),
      capacityHoursPerWeek: '40.00',
      costRateHour: user.costRateHour,
      billRateHour: (Number(user.costRateHour) * 1.6).toFixed(4),
      workCalendarId: ctx.calendarId,
      location: 'São Paulo/SP',
      createdBy,
    })),
  );

  const skillIds: Record<string, string> = {};
  const skillNames = [...new Set(staff.flatMap((user) => user.skills.map(([name]) => name)))];
  await tx.insert(skills).values(
    skillNames.map((name) => {
      const id = newId();
      skillIds[name] = id;
      return { id, tenantId, name, createdBy };
    }),
  );
  await tx.insert(userSkills).values(
    staff.flatMap((user) =>
      user.skills.map(([name, level]) => ({
        tenantId,
        userId: userId(ctx, user.key),
        skillId: skillIds[name] ?? newId(),
        level,
        createdBy,
      })),
    ),
  );

  const inProgress = DEMANDS.filter((demand) => demand.group === 'andamento');
  for (const demand of inProgress) {
    const dates = pmsp.demandDates.get(demand.name);
    const itemId = pmsp.itemIds.get(demand.name);
    if (dates?.startDate === undefined || dates.startDate === null || itemId === undefined)
      continue;
    const endDate = dates.replannedEnd ?? dates.plannedEnd ?? addDays(dates.startDate, 30);
    await tx.insert(allocations).values(
      demand.owners.map((key, index) => ({
        tenantId,
        userId: userId(ctx, key),
        boardId: pmsp.boardId,
        itemId,
        startDate: dates.startDate ?? SEED_REFERENCE_DATE,
        endDate,
        hoursPerDay: index === 0 ? '4.00' : '2.00',
        status: 'confirmed' as const,
        createdBy,
      })),
    );
  }

  await tx.insert(absences).values([
    {
      tenantId,
      userId: userId(ctx, 'mariana'),
      type: 'vacation',
      startDate: '2026-11-03',
      endDate: '2026-11-14',
      status: 'approved',
      approvedBy: createdBy,
      approvedAt: at('2026-09-20'),
      notes: 'Férias programadas.',
      createdBy,
    },
    {
      tenantId,
      userId: userId(ctx, 'juliana'),
      type: 'training',
      startDate: '2026-10-22',
      endDate: '2026-10-23',
      hoursPerDay: '8.00',
      status: 'submitted',
      notes: 'Treinamento gov.br.',
      createdBy,
    },
  ]);

  await tx.insert(resourceRequests).values({
    tenantId,
    boardId: pmsp.boardId,
    skillId: skillIds['UX Research'] ?? null,
    roleTitle: 'UX Designer pleno',
    hours: '160.00',
    startDate: '2026-11-03',
    endDate: '2026-11-28',
    status: 'open',
    notes: 'Cobrir férias da Mariana e a demanda do Portal OGM.',
    createdBy: userId(ctx, 'fernanda'),
  });

  // Timesheet: duas semanas úteis anteriores à data de referência.
  const weekStarts = ['2026-09-28', '2026-10-05'];
  const loggers = ['juliana', 'rafael', 'bruno', 'mariana'];
  for (const key of loggers) {
    const ownedItems = inProgress.filter((demand) => demand.owners.includes(key));
    if (ownedItems.length === 0) continue;
    for (const [weekIndex, weekStart] of weekStarts.entries()) {
      const approvalId = newId();
      let totalMinutes = 0;
      const entries = [];
      for (let day = 0; day < 5; day += 1) {
        const entryDate = day === 0 ? weekStart : addBusinessDays(weekStart, day);
        const demand = ownedItems[(day + weekIndex) % ownedItems.length];
        const itemId = demand === undefined ? undefined : pmsp.itemIds.get(demand.name);
        if (itemId === undefined) continue;
        const minutes = rng.int(5, 8) * 60;
        totalMinutes += minutes;
        entries.push({
          tenantId,
          userId: userId(ctx, key),
          boardId: pmsp.boardId,
          itemId,
          entryDate,
          minutes,
          description: 'Execução das atividades da OS',
          isBillable: true,
          source: 'manual' as const,
          status: weekIndex === 0 ? ('approved' as const) : ('submitted' as const),
          approvalId,
          createdBy: userId(ctx, key),
        });
      }
      await tx.insert(timesheetApprovals).values({
        id: approvalId,
        tenantId,
        userId: userId(ctx, key),
        periodStart: weekStart,
        periodEnd: addDays(weekStart, 6),
        status: weekIndex === 0 ? 'approved' : 'submitted',
        totalMinutes,
        submittedAt: at(addDays(weekStart, 4), '18:00'),
        reviewedBy: weekIndex === 0 ? userId(ctx, 'fernanda') : null,
        reviewedAt: weekIndex === 0 ? at(addDays(weekStart, 7), '10:00') : null,
        createdBy: userId(ctx, key),
      });
      await tx.insert(timeEntries).values(entries);
    }
  }
}
