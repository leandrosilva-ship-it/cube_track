import { DEFAULT_CALENDAR, type WorkingCalendar } from '@cube-track/shared';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';

import type { Transaction } from './client.js';
import { boards, holidays, resourceProfiles, workCalendars } from './schema/index.js';

type CalendarRow = typeof workCalendars.$inferSelect;

/** Resolve feriados (nacional ∪ UF ∪ município ∪ empresa) para um calendário já carregado (ou nenhum). */
async function loadCalendar(
  tx: Transaction,
  tenantId: string,
  calendar: CalendarRow | undefined,
  from: string,
): Promise<WorkingCalendar> {
  const locality = [eq(holidays.scope, 'national')];
  if (calendar?.stateCode !== undefined && calendar.stateCode !== null)
    locality.push(
      and(eq(holidays.scope, 'state'), eq(holidays.stateCode, calendar.stateCode)) ?? sql`false`,
    );
  if (calendar?.cityIbgeCode !== undefined && calendar.cityIbgeCode !== null) {
    locality.push(
      and(eq(holidays.scope, 'municipal'), eq(holidays.cityIbgeCode, calendar.cityIbgeCode)) ??
        sql`false`,
    );
  }
  const tenantScoped = and(
    eq(holidays.tenantId, tenantId),
    calendar === undefined
      ? isNull(holidays.calendarId)
      : or(isNull(holidays.calendarId), eq(holidays.calendarId, calendar.id)),
  );
  const rows = await tx
    .select({ date: holidays.date })
    .from(holidays)
    .where(
      and(
        gte(holidays.date, from),
        eq(holidays.isOptional, false),
        isNull(holidays.deletedAt),
        or(and(isNull(holidays.tenantId), or(...locality)), tenantScoped),
      ),
    );
  if (calendar === undefined)
    return { ...DEFAULT_CALENDAR, holidays: new Set(rows.map((row) => row.date)) };
  return { workingDays: calendar.workingDays, holidays: new Set(rows.map((row) => row.date)) };
}

async function loadCalendarById(
  tx: Transaction,
  calendarId: string | null | undefined,
): Promise<CalendarRow | undefined> {
  const filter =
    calendarId === undefined || calendarId === null
      ? and(eq(workCalendars.isDefault, true), isNull(workCalendars.deletedAt))
      : and(eq(workCalendars.id, calendarId), isNull(workCalendars.deletedAt));
  const [calendar] = await tx.select().from(workCalendars).where(filter).limit(1);
  return calendar;
}

/** Calendário efetivo do board: calendário do board → padrão do tenant → seg–sex sem feriados. */
export async function loadWorkingCalendar(
  tx: Transaction,
  tenantId: string,
  boardId: string,
  from: string,
): Promise<WorkingCalendar> {
  const [board] = await tx
    .select({ calendarId: boards.workCalendarId })
    .from(boards)
    .where(eq(boards.id, boardId));
  const calendar = await loadCalendarById(tx, board?.calendarId);
  return loadCalendar(tx, tenantId, calendar, from);
}

/**
 * Calendário efetivo de uma pessoa (ADR 0052): calendário do perfil de recurso → padrão do tenant →
 * seg–sex sem feriados — mesma cadeia de fallback de `loadWorkingCalendar`, só que ancorada em
 * `resource_profiles.work_calendar_id` em vez de `boards.work_calendar_id`.
 */
export async function loadPersonWorkingCalendar(
  tx: Transaction,
  tenantId: string,
  userId: string,
  from: string,
): Promise<WorkingCalendar> {
  const [profile] = await tx
    .select({ calendarId: resourceProfiles.workCalendarId })
    .from(resourceProfiles)
    .where(and(eq(resourceProfiles.tenantId, tenantId), eq(resourceProfiles.userId, userId)));
  const calendar = await loadCalendarById(tx, profile?.calendarId);
  return loadCalendar(tx, tenantId, calendar, from);
}
