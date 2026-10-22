import { shiftDays } from '@cube-track/shared';

export interface CalendarDay {
  date: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function toDay(date: string, currentMonth: string, today: string): CalendarDay {
  const weekday = isoWeekday(date);
  return {
    date,
    inCurrentMonth: date.slice(0, 7) === currentMonth,
    isToday: date === today,
    isWeekend: weekday === 6 || weekday === 7,
  };
}

/** Primeiro dia do mês (`YYYY-MM-DD`) a partir de `year`/`month` (0-11). */
export function monthStart(year: number, month: number): string {
  const normalizedMonth = ((month % 12) + 12) % 12;
  const normalizedYear = year + Math.floor(month / 12);
  return `${String(normalizedYear).padStart(4, '0')}-${String(normalizedMonth + 1).padStart(2, '0')}-01`;
}

/** Semanas completas (segunda a domingo) cobrindo o mês de `monthStartDate`. */
export function monthGrid(monthStartDate: string, today: string): CalendarDay[][] {
  const currentMonth = monthStartDate.slice(0, 7);
  const firstWeekday = isoWeekday(monthStartDate);
  const gridStart = shiftDays(monthStartDate, -(firstWeekday - 1));
  const [year, month] = monthStartDate.split('-').map(Number) as [number, number];
  const daysInMonth = daysInMonthOf(year, month);
  const monthEnd = shiftDays(monthStartDate, daysInMonth - 1);
  const lastWeekday = isoWeekday(monthEnd);
  const gridEnd = shiftDays(monthEnd, 7 - lastWeekday);

  const weeks: CalendarDay[][] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(toDay(cursor, currentMonth, today));
      cursor = shiftDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function daysInMonthOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 7 dias (segunda a domingo) da semana que contém `date`. */
export function weekOf(date: string, today: string): CalendarDay[] {
  const start = shiftDays(date, -(isoWeekday(date) - 1));
  return Array.from({ length: 7 }, (_, index) => toDay(shiftDays(start, index), date.slice(0, 7), today));
}

/** Nomes curtos dos dias da semana (segunda a domingo) no locale informado. */
export function weekdayLabels(locale: string): string[] {
  // 2024-01-01 é uma segunda-feira (base estável para formatar os 7 dias da semana).
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(
      new Date(Date.UTC(2024, 0, 1 + index)),
    ),
  );
}

export function monthTitle(monthStartDate: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
    new Date(`${monthStartDate}T00:00:00Z`),
  );
}

export function dayTitle(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00Z`));
}
