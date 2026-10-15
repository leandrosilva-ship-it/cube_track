import { DEFAULT_CALENDAR, type WorkingCalendar } from '@cube-track/shared';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';

import type { Transaction } from './client.js';
import { boards, holidays, workCalendars } from './schema/index.js';

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
  const calendarFilter =
    board?.calendarId === undefined || board.calendarId === null
      ? and(eq(workCalendars.isDefault, true), isNull(workCalendars.deletedAt))
      : and(eq(workCalendars.id, board.calendarId), isNull(workCalendars.deletedAt));
  const [calendar] = await tx.select().from(workCalendars).where(calendarFilter).limit(1);

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
