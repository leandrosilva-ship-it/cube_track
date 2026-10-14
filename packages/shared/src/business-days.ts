/**
 * Calendário de dias úteis (ADR 0019). Datas são strings ISO `YYYY-MM-DD` (datas de negócio, sem fuso).
 * Feriados chegam já resolvidos (nacionais + UF + município + empresa) pelo chamador.
 */

export interface WorkingCalendar {
  /** Dias úteis ISO (1 = segunda … 7 = domingo). */
  workingDays: readonly number[];
  /** Feriados não facultativos no formato `YYYY-MM-DD`. */
  holidays: ReadonlySet<string>;
}

export const DEFAULT_CALENDAR: WorkingCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: new Set(),
};

function toDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`Data inválida: ${value}`);
  return new Date(`${value}T00:00:00Z`);
}

export function shiftDays(value: string, days: number): string {
  const date = toDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isoWeekday(value: string): number {
  const day = toDate(value).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isBusinessDay(value: string, calendar: WorkingCalendar): boolean {
  return calendar.workingDays.includes(isoWeekday(value)) && !calendar.holidays.has(value);
}

function assertCalendar(calendar: WorkingCalendar): void {
  if (calendar.workingDays.length === 0) throw new RangeError('Calendário sem dias úteis');
}

/** Primeiro dia útil em `value` ou depois (`direction = 1`) / antes (`-1`). */
export function alignToBusinessDay(
  value: string,
  calendar: WorkingCalendar,
  direction: 1 | -1 = 1,
): string {
  assertCalendar(calendar);
  let current = value;
  while (!isBusinessDay(current, calendar)) current = shiftDays(current, direction);
  return current;
}

/**
 * Soma `amount` dias úteis. Com `amount = 0` retorna o próprio dia alinhado ao próximo dia útil.
 * Valores negativos andam para trás.
 */
export function addBusinessDays(value: string, amount: number, calendar: WorkingCalendar): string {
  assertCalendar(calendar);
  if (!Number.isInteger(amount)) throw new RangeError('Quantidade de dias deve ser inteira');
  const direction = amount < 0 ? -1 : 1;
  let current = alignToBusinessDay(value, calendar, direction);
  let remaining = Math.abs(amount);
  while (remaining > 0) {
    current = shiftDays(current, direction);
    if (isBusinessDay(current, calendar)) remaining -= 1;
  }
  return current;
}

/** Dias úteis entre duas datas, inclusive (0 se `to` < `from`). */
export function businessDaysBetween(from: string, to: string, calendar: WorkingCalendar): number {
  if (to < from) return 0;
  let count = 0;
  for (let current = from; current <= to; current = shiftDays(current, 1)) {
    if (isBusinessDay(current, calendar)) count += 1;
  }
  return count;
}
