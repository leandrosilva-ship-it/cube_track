import { DEFAULT_CURRENCY, type Locale } from './locales.js';

/**
 * Formatadores baseados em `Intl` (ADR 0019). Datas de negócio (`YYYY-MM-DD`) não têm fuso e são
 * formatadas em UTC para nunca "voltar um dia"; instantes (`timestamptz`) usam o fuso do usuário.
 * Valores decimais (dinheiro, UST) chegam como string e são formatados sem passar por `float`.
 */

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DateStyle = 'short' | 'medium' | 'long' | 'weekday' | 'dayMonth';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  medium: { day: '2-digit', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'short', day: '2-digit', month: 'short' },
  dayMonth: { day: '2-digit', month: 'short' },
};

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
  key: string,
  create: () => T,
): T {
  const existing = cache.get(key);
  if (existing !== undefined) return existing as T;
  const created = create();
  cache.set(key, created);
  return created;
}

export function isBusinessDate(value: string): boolean {
  return BUSINESS_DATE.test(value);
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return isBusinessDate(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
}

export interface DateFormatOptions {
  style?: DateStyle;
  /** Fuso para instantes (padrão: America/Sao_Paulo). Ignorado para datas de negócio. */
  timeZone?: string;
}

export function formatDate(
  value: Date | string,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  const style = options.style ?? 'short';
  const timeZone =
    typeof value === 'string' && isBusinessDate(value)
      ? 'UTC'
      : (options.timeZone ?? 'America/Sao_Paulo');
  const formatter = cached(
    `d:${locale}:${style}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { ...DATE_OPTIONS[style], timeZone }),
  );
  return formatter.format(toDate(value)).replace(/\.$/, '');
}

export function formatDateTime(
  value: Date | string,
  locale: Locale,
  timeZone = 'America/Sao_Paulo',
): string {
  const formatter = cached(
    `dt:${locale}:${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
      }),
  );
  return formatter.format(toDate(value));
}

export function formatNumber(
  value: number | string,
  locale: Locale,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  const min = options.minimumFractionDigits ?? 0;
  const max = Math.max(min, options.maximumFractionDigits ?? 2);
  const formatter = cached(
    `n:${locale}:${min}:${max}`,
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max }),
  );
  return formatter.format(toNumeric(value));
}

/** Moeda (padrão BRL). Aceita string decimal para preservar a precisão. */
export function formatCurrency(value: number | string, locale: Locale, currency?: string): string {
  const code = currency ?? DEFAULT_CURRENCY[locale];
  const formatter = cached(
    `c:${locale}:${code}`,
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: code }),
  );
  return formatter.format(toNumeric(value));
}

export function formatPercent(value: number, locale: Locale, maximumFractionDigits = 0): string {
  const formatter = cached(
    `p:${locale}:${maximumFractionDigits}`,
    () => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits }),
  );
  return formatter.format(value);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** "há 5 minutos", "em 2 dias" — escolhe a maior unidade que cabe. */
export function formatRelativeTime(value: Date | string, locale: Locale, now = new Date()): string {
  const seconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
  const formatter = cached(
    `r:${locale}`,
    () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
  );
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(0, 'second');
}

/** `Intl.NumberFormat` aceita strings decimais (precisão preservada); validamos o formato. */
function toNumeric(value: number | string): number {
  if (typeof value === 'number') return value;
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) throw new RangeError(`Número inválido: ${value}`);
  // O tipo do TS exige number, mas o runtime (ES2023 Intl.NumberFormat v3) formata a string exata.
  return value.trim() as unknown as number;
}
