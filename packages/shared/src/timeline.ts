import { shiftDays } from './business-days.js';

/**
 * Escala de tempo para Timeline/Roadmap e Gantt (Prompt 8): conversão entre datas (`YYYY-MM-DD`,
 * dias corridos — ao contrário do calendário de dias úteis usado no agendamento) e posição
 * horizontal em pixels, marcações do eixo por nível de zoom e o intervalo visível padrão a partir
 * de um conjunto de tarefas. Função pura, sem DOM: o componente React só lê os números daqui.
 */

export const TIME_ZOOMS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type TimeZoom = (typeof TIME_ZOOMS)[number];

/** Largura (px) de um dia em cada nível de zoom — calibrado para rótulos legíveis sem sobrepor. */
export const ZOOM_PX_PER_DAY: Record<TimeZoom, number> = {
  day: 64,
  week: 28,
  month: 10,
  quarter: 4,
  year: 1.4,
};

export interface TimelineRange {
  start: string;
  end: string;
}

export interface TimeTick {
  date: string;
  label: string;
  /** Início de mês/ano — linha de grade mais forte. */
  major: boolean;
}

function toUtc(value: string): number {
  return new Date(`${value}T00:00:00Z`).getTime();
}

/** Dias corridos entre duas datas ISO (`to` − `from`); pode ser negativo. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Posição horizontal (px) de uma data dentro do intervalo visível. */
export function dateToX(date: string, rangeStart: string, pxPerDay: number): number {
  return daysBetween(rangeStart, date) * pxPerDay;
}

/** Data correspondente a uma posição horizontal (px), arredondada para o dia mais próximo. */
export function xToDate(x: number, rangeStart: string, pxPerDay: number): string {
  return shiftDays(rangeStart, Math.round(x / pxPerDay));
}

/** Largura (px) de uma barra que cobre `start`..`end` (inclusive), nunca menor que um dia. */
export function durationPx(start: string, end: string, pxPerDay: number): number {
  return Math.max(pxPerDay, (daysBetween(start, end) + 1) * pxPerDay);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function isMonthStart(date: string): boolean {
  return date.endsWith('-01');
}

function isYearStart(date: string): boolean {
  return date.endsWith('-01-01');
}

function monthLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function dayLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function weekLabel(date: string, locale: string): string {
  return dayLabel(date, locale);
}

/**
 * Marcações do eixo para o zoom escolhido: um tick por dia (`day`), por semana — início na
 * segunda — (`week`), por mês (`month`/`quarter`) ou por trimestre (`year`). `locale` segue o
 * padrão do projeto (pt-BR).
 */
export function buildTicks(range: TimelineRange, zoom: TimeZoom, locale = 'pt-BR'): TimeTick[] {
  const ticks: TimeTick[] = [];
  if (zoom === 'day') {
    for (let date = range.start; date <= range.end; date = shiftDays(date, 1)) {
      ticks.push({ date, label: dayLabel(date, locale), major: isMonthStart(date) });
    }
    return ticks;
  }
  if (zoom === 'week') {
    for (let date = range.start; date <= range.end; date = shiftDays(date, 7)) {
      ticks.push({ date, label: weekLabel(date, locale), major: isMonthStart(date) });
    }
    return ticks;
  }
  if (zoom === 'month' || zoom === 'quarter') {
    let date = startOfMonth(range.start);
    while (date <= range.end) {
      ticks.push({ date, label: monthLabel(date, locale), major: isYearStart(date) });
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      date = next.toISOString().slice(0, 10);
    }
    return ticks;
  }
  // year: um tick por trimestre.
  let date = startOfMonth(range.start);
  while (date <= range.end) {
    ticks.push({ date, label: monthLabel(date, locale), major: isYearStart(date) });
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 3);
    date = next.toISOString().slice(0, 10);
  }
  return ticks;
}

/**
 * Intervalo visível padrão a partir das tarefas (menor início − `paddingDays`, maior fim +
 * `paddingDays`). Sem nenhuma tarefa datada, usa hoje ± `paddingDays`.
 */
export function defaultRange(
  tasks: readonly { start: string | null; end: string | null }[],
  paddingDays = 7,
  today = new Date().toISOString().slice(0, 10),
): TimelineRange {
  const dates = tasks.flatMap((task) => [task.start, task.end]).filter((d): d is string => d !== null);
  if (dates.length === 0) {
    return { start: shiftDays(today, -paddingDays), end: shiftDays(today, paddingDays) };
  }
  const start = dates.reduce((min, date) => (date < min ? date : min));
  const end = dates.reduce((max, date) => (date > max ? date : max));
  return { start: shiftDays(start, -paddingDays), end: shiftDays(end, paddingDays) };
}
