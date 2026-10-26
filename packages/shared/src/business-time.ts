/**
 * Aritmética de minutos úteis (ADR 0051): usada pelo SLA de fases (`useBusinessTime`). Opera no
 * fuso do calendário de trabalho; assume deslocamento fixo (sem horário de verão — o Brasil não usa
 * DST desde 2019, o fuso padrão do produto).
 */

export interface WorkHoursCalendar {
  /** Dias úteis ISO (1 = segunda … 7 = domingo). */
  workingDays: readonly number[];
  /** Feriados não facultativos no formato `YYYY-MM-DD` (no fuso do calendário). */
  holidays: ReadonlySet<string>;
  /** `HH:MM` (24h), fuso do calendário. */
  workStart: string;
  /** `HH:MM` (24h), fuso do calendário. */
  workEnd: string;
  timeZone: string;
}

function parseHm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Deslocamento fixo (minutos) do fuso em relação ao UTC no instante dado. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

interface LocalInstant {
  /** Data ISO `YYYY-MM-DD` no fuso do calendário. */
  dateIso: string;
  /** Minutos desde a meia-noite local. */
  minuteOfDay: number;
  weekday: number;
}

function toLocal(instant: Date, timeZone: string): LocalInstant {
  const local = new Date(instant.getTime() + offsetMinutes(instant, timeZone) * 60_000);
  const dateIso = local.toISOString().slice(0, 10);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  return { dateIso, minuteOfDay, weekday };
}

function fromLocal(dateIso: string, minuteOfDay: number, timeZone: string): Date {
  const naiveUtc = new Date(`${dateIso}T00:00:00Z`);
  naiveUtc.setUTCMinutes(naiveUtc.getUTCMinutes() + minuteOfDay);
  const offset = offsetMinutes(naiveUtc, timeZone);
  return new Date(naiveUtc.getTime() - offset * 60_000);
}

function isBusinessDay(dateIso: string, weekday: number, calendar: WorkHoursCalendar): boolean {
  return calendar.workingDays.includes(weekday) && !calendar.holidays.has(dateIso);
}

function nextBusinessDayStart(afterDateIso: string, calendar: WorkHoursCalendar): LocalInstant {
  let dateIso = afterDateIso;
  for (;;) {
    const date = new Date(`${dateIso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    dateIso = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
    if (isBusinessDay(dateIso, weekday, calendar))
      return { dateIso, minuteOfDay: parseHm(calendar.workStart), weekday };
  }
}

/**
 * Soma `minutes` minutos úteis a `startAt`, pulando noites, fins de semana e feriados do
 * calendário. Fora do expediente, o relógio começa a contar do próximo início de expediente.
 */
export function addBusinessMinutes(
  startAt: Date,
  minutes: number,
  calendar: WorkHoursCalendar,
): Date {
  if (minutes < 0) throw new RangeError('minutes deve ser >= 0');
  const workStart = parseHm(calendar.workStart);
  const workEnd = parseHm(calendar.workEnd);
  if (workEnd <= workStart) throw new RangeError('workEnd deve ser depois de workStart');

  let current = toLocal(startAt, calendar.timeZone);
  if (
    !isBusinessDay(current.dateIso, current.weekday, calendar) ||
    current.minuteOfDay >= workEnd
  ) {
    current = nextBusinessDayStart(current.dateIso, calendar);
  } else if (current.minuteOfDay < workStart) {
    current = { ...current, minuteOfDay: workStart };
  }

  let remaining = minutes;
  for (;;) {
    const availableToday = workEnd - current.minuteOfDay;
    if (remaining <= availableToday) {
      return fromLocal(current.dateIso, current.minuteOfDay + remaining, calendar.timeZone);
    }
    remaining -= availableToday;
    current = nextBusinessDayStart(current.dateIso, calendar);
  }
}
