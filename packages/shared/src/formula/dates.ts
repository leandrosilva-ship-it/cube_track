/**
 * Utilitários de datas de negócio (`YYYY-MM-DD`, sem fuso) e data-hora ISO (UTC) para fórmulas.
 */

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Monta a data se ano/mês/dia formam um dia válido entre os anos 1 e 9999. */
export function makeDate(year: number, month: number, day: number): string | null {
  if (![year, month, day].every(Number.isInteger)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0);
  return date.getUTCDate();
}

export function isValidDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  return makeDate(Number(match[1]), Number(match[2]), Number(match[3])) !== null;
}

export function isValidDatetime(value: string): boolean {
  return ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value));
}

export function dateParts(value: string): { year: number; month: number; day: number } {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

/** Milissegundos desde a época para a data à meia-noite UTC. */
export function dateToMs(value: string): number {
  const { year, month, day } = dateParts(value);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

export function msToDate(ms: number): string | null {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function datetimeToMs(value: string): number {
  return Date.parse(value);
}

export function msToDatetime(ms: number): string | null {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  if (Number.isNaN(year) || year < 1 || year > 9999) return null;
  return date.toISOString();
}

/** Data (UTC) de um instante ISO. */
export function datetimeToDate(value: string): string | null {
  return msToDate(datetimeToMs(value));
}

/** Diferença em dias corridos (`end - start`). */
export function daysBetween(start: string, end: string): number {
  return Math.round((dateToMs(end) - dateToMs(start)) / DAY_MS);
}

export function addDays(value: string, days: number): string | null {
  return msToDate(dateToMs(value) + days * DAY_MS);
}

/** Soma meses mantendo o dia, limitado ao último dia do mês de destino (como EDATE). */
export function addMonths(value: string, months: number): string | null {
  const { year, month, day } = dateParts(value);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  if (targetYear < 1 || targetYear > 9999) return null;
  return makeDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function endOfMonth(value: string, months: number): string | null {
  const shifted = addMonths(`${value.slice(0, 8)}01`, months);
  if (shifted === null) return null;
  const { year, month } = dateParts(shifted);
  return makeDate(year, month, daysInMonth(year, month));
}

/** Semana ISO 8601 (semanas começam na segunda; a semana 1 contém a primeira quinta-feira). */
export function isoWeekNumber(value: string): number {
  const ms = dateToMs(value);
  const weekday = new Date(ms).getUTCDay() || 7;
  const thursday = new Date(ms + (4 - weekday) * DAY_MS);
  const yearStart = new Date(0);
  yearStart.setUTCFullYear(thursday.getUTCFullYear(), 0, 1);
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

/** Interpreta texto como data: `YYYY-MM-DD`, data-hora ISO ou `DD/MM/YYYY` (pt-BR). */
export function parseDateText(text: string): string | null {
  const value = text.trim();
  if (isValidDate(value)) return value;
  if (isValidDatetime(value)) return datetimeToDate(value);
  const match = BR_DATE.exec(value);
  if (!match) return null;
  return makeDate(Number(match[3]), Number(match[2]), Number(match[1]));
}

const DATE_TOKENS = ['YYYY', 'YY', 'MM', 'M', 'DD', 'D'] as const;

/** Formata a data com os tokens YYYY, YY, MM, M, DD e D; demais caracteres são copiados. */
export function formatDate(value: string, pattern: string): string {
  const { year, month, day } = dateParts(value);
  const replacements: Record<(typeof DATE_TOKENS)[number], string> = {
    YYYY: pad(year, 4),
    YY: pad(year % 100),
    MM: pad(month),
    M: String(month),
    DD: pad(day),
    D: String(day),
  };
  let output = '';
  let index = 0;
  while (index < pattern.length) {
    const token = DATE_TOKENS.find((candidate) => pattern.startsWith(candidate, index));
    if (token) {
      output += replacements[token];
      index += token.length;
    } else {
      output += pattern.charAt(index);
      index += 1;
    }
  }
  return output;
}
