/**
 * Coluna de ID automático com máscara configurável (ex.: `{YYYY}-{SEQ:4}` → `2026-0924`).
 *
 * Tokens suportados:
 * - `{YYYY}` ano com 4 dígitos, `{YY}` ano com 2 dígitos, `{MM}` mês, `{DD}` dia;
 * - `{SEQ}` sequencial sem preenchimento, `{SEQ:n}` sequencial com `n` dígitos (zeros à esquerda).
 *
 * A mesma regra é implementada em SQL (`app.format_display_id`) para a geração no banco;
 * os testes de integração garantem que as duas implementações produzem o mesmo resultado.
 */

export const AUTO_ID_RESET_PERIODS = ['never', 'yearly', 'monthly'] as const;
export type AutoIdResetPeriod = (typeof AUTO_ID_RESET_PERIODS)[number];

export const DEFAULT_AUTO_ID_MASK = '{YYYY}-{SEQ:4}';

const TOKEN_PATTERN = /\{(YYYY|YY|MM|DD|SEQ(?::(\d{1,2}))?)\}/g;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** Valida uma máscara: precisa conter exatamente um token de sequência. */
export function isValidDisplayIdMask(mask: string): boolean {
  if (mask.length === 0 || mask.length > 64) return false;
  const seqTokens = mask.match(/\{SEQ(?::\d{1,2})?\}/g) ?? [];
  return seqTokens.length === 1;
}

export function formatDisplayId(mask: string, sequence: number, date: CalendarDate): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError(`Sequência inválida: ${sequence}`);
  }
  return mask.replace(TOKEN_PATTERN, (_match, token: string, width: string | undefined) => {
    switch (token) {
      case 'YYYY':
        return pad(date.year, 4);
      case 'YY':
        return pad(date.year % 100, 2);
      case 'MM':
        return pad(date.month, 2);
      case 'DD':
        return pad(date.day, 2);
      default:
        return width === undefined ? String(sequence) : pad(sequence, Number(width));
    }
  });
}

/** Chave do período de reinício do contador (`''`, `'2026'` ou `'2026-03'`). */
export function displayIdPeriodKey(period: AutoIdResetPeriod, date: CalendarDate): string {
  switch (period) {
    case 'never':
      return '';
    case 'yearly':
      return pad(date.year, 4);
    case 'monthly':
      return `${pad(date.year, 4)}-${pad(date.month, 2)}`;
  }
}

/** Converte um instante para data de calendário no fuso informado (padrão America/Sao_Paulo). */
export function toCalendarDate(instant: Date, timeZone = 'America/Sao_Paulo'): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}
