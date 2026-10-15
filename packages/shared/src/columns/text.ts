import { Decimal } from '../decimal.js';

import { COLUMN_TYPE_SPECS, isColumnType, READ_ONLY_COLUMN_TYPES } from './registry.js';

/**
 * Conversão texto ↔ valor de coluna. A mesma regra serve para colar células na Tabela (cliente),
 * importar planilhas e exportar CSV/Excel (servidor), garantindo ida e volta sem perda.
 * Os formatos seguem o idioma (pt-BR: `1.234,56`, `14/10/2026`; en: `1,234.56`, `10/14/2026`).
 */

export interface CellTextColumn {
  key: string;
  type: string;
  settings: Readonly<Record<string, unknown>>;
  labels?: readonly { id: string; label: string }[];
  options?: readonly { id: string; label: string }[];
}

export interface CellTextDirectory {
  people: readonly { id: string; name: string; email?: string | null }[];
  teams: readonly { id: string; name: string }[];
  /** Itens candidatos para colunas de relação (por nome). */
  items?: readonly { id: string; name: string }[];
}

export type CellTextLocale = 'pt-BR' | 'en' | 'es';

export type ParseCellResult =
  | { ok: true; value: Record<string, unknown> | null }
  | {
      ok: false;
      reason:
        | 'invalid'
        | 'read_only'
        | 'unknown_label'
        | 'unknown_option'
        | 'unknown_person'
        | 'unknown_item';
      /** Textos não encontrados (rótulos/opções/pessoas), para o importador criar ou relatar. */
      unknown?: string[];
    };

const EMPTY_DIRECTORY: CellTextDirectory = { people: [], teams: [] };

/** Normaliza para comparação: minúsculas, sem acentos e espaços extras. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitList(text: string): string[] {
  return text
    .split(/[;,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

// ------------------------------------------------------------------------------------ números ---

const DECIMAL_PATTERN = /^-?\d{1,14}(\.\d{1,4})?$/;

/** Interpreta número com separadores do idioma, unidade (UST, R$, h, %) e sinal. */
export function parseLocaleNumber(text: string, locale: CellTextLocale = 'pt-BR'): string | null {
  let cleaned = text.replace(/[^\d,.\-+]/g, '');
  if (cleaned === '' || !/\d/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-') || /^\(.*\)$/.test(text.trim());
  cleaned = cleaned.replace(/[-+]/g, '');
  const commas = (cleaned.match(/,/g) ?? []).length;
  const dots = (cleaned.match(/\./g) ?? []).length;
  let normalized: string;
  if (commas > 0 && dots > 0) {
    const decimalSeparator = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    const thousands = decimalSeparator === ',' ? '.' : ',';
    normalized = cleaned.split(thousands).join('').replace(decimalSeparator, '.');
  } else if (commas > 0) {
    // Vírgula: decimal em pt-BR/es; em inglês, separador de milhar quando agrupa de 3 em 3.
    normalized =
      locale === 'en' && /^\d{1,3}(,\d{3})+$/.test(cleaned)
        ? cleaned.replace(/,/g, '')
        : commas === 1
          ? cleaned.replace(',', '.')
          : cleaned.replace(/,/g, '');
  } else if (dots > 1 || (locale !== 'en' && /^\d{1,3}(\.\d{3})+$/.test(cleaned))) {
    normalized = cleaned.replace(/\./g, '');
  } else {
    normalized = cleaned;
  }
  if (!/^\d*\.?\d+$/.test(normalized)) return null;
  // Até 4 casas (formato de armazenamento); arredonda metade para longe do zero.
  const rounded = new Decimal(normalized).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const value = rounded.isZero() ? '0' : (negative ? rounded.negated() : rounded).toString();
  return DECIMAL_PATTERN.test(value) ? value : null;
}

/** Decimal → texto do idioma, sem separador de milhar (colável no Excel e reimportável). */
export function formatDecimalText(
  value: string,
  locale: CellTextLocale = 'pt-BR',
  decimals?: number,
): string {
  let text = value;
  if (decimals !== undefined && /^-?\d+(\.\d+)?$/.test(value)) {
    const [integer = '0', fraction = ''] = value.split('.');
    text =
      decimals === 0 ? integer : `${integer}.${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
  }
  return locale === 'en' ? text : text.replace('.', ',');
}

// -------------------------------------------------------------------------------------- datas ---

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

/** Data (e hora opcional) em `dd/mm/aaaa`, `aaaa-mm-dd`, `dd/mm/aa`; en: `mm/dd/aaaa`. */
export function parseLocaleDate(
  text: string,
  locale: CellTextLocale = 'pt-BR',
): { d: string; time?: string } | null {
  const trimmed = text.trim();
  const timeMatch = /(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)$/.exec(
    trimmed,
  );
  const datePart = timeMatch === null ? trimmed : trimmed.slice(0, timeMatch.index);
  let date: string | null = null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(datePart);
  if (iso !== null) date = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else if (local !== null) {
    const first = Number(local[1]);
    const second = Number(local[2]);
    const rawYear = Number(local[3]);
    const year = (local[3] ?? '').length === 2 ? 2000 + rawYear : rawYear;
    date = locale === 'en' ? validDate(year, first, second) : validDate(year, second, first);
  }
  if (date === null) return null;
  if (timeMatch === null) return { d: date };
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (hours > 23 || minutes > 59) return null;
  return { d: date, time: `${pad(hours)}:${pad(minutes)}` };
}

export function formatLocaleDate(iso: string, locale: CellTextLocale = 'pt-BR'): string {
  const [year = '', month = '', day = ''] = iso.slice(0, 10).split('-');
  return locale === 'en' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

// ----------------------------------------------------------------------------------- booleanos ---

const TRUE_WORDS = new Set([
  'sim',
  's',
  'yes',
  'y',
  'si',
  'true',
  'verdadeiro',
  '1',
  'x',
  'v',
  '✓',
  '✔',
  'ok',
]);
const FALSE_WORDS = new Set(['nao', 'n', 'no', 'false', 'falso', '0', '']);

function matchByName<T extends { id: string }>(
  entries: readonly T[],
  wanted: readonly string[],
  names: (entry: T) => (string | null | undefined)[],
): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const text of wanted) {
    const target = normalizeForMatch(text);
    const exact = entries.find((entry) =>
      names(entry).some(
        (name) => name !== null && name !== undefined && normalizeForMatch(name) === target,
      ),
    );
    if (exact === undefined) unknown.push(text);
    else if (!ids.includes(exact.id)) ids.push(exact.id);
  }
  return { ids, unknown };
}

function validate(type: string, value: Record<string, unknown>): ParseCellResult {
  if (!isColumnType(type)) return { ok: false, reason: 'invalid' };
  const parsed = COLUMN_TYPE_SPECS[type].value.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data as Record<string, unknown> }
    : { ok: false, reason: 'invalid' };
}

/** Converte o texto de uma célula (colado ou importado) no valor da coluna; vazio limpa. */
export function parseCellText(
  column: CellTextColumn,
  text: string,
  directory: CellTextDirectory = EMPTY_DIRECTORY,
  locale: CellTextLocale = 'pt-BR',
): ParseCellResult {
  if (isColumnType(column.type) && READ_ONLY_COLUMN_TYPES.has(column.type))
    return { ok: false, reason: 'read_only' };
  const trimmed = text.trim();
  if (column.type === 'checkbox') {
    const word = normalizeForMatch(trimmed);
    if (TRUE_WORDS.has(word)) return { ok: true, value: { checked: true } };
    if (FALSE_WORDS.has(word)) return { ok: true, value: null };
    return { ok: false, reason: 'invalid' };
  }
  if (trimmed === '') return { ok: true, value: null };
  switch (column.type) {
    case 'text':
      return validate('text', { text: trimmed });
    case 'long_text':
      return validate('long_text', { text: text.replace(/\r\n/g, '\n').trim() });
    case 'number':
    case 'rating': {
      const stars = /^[★⭐]+$/u.test(trimmed)
        ? String(Array.from(trimmed.matchAll(/[★⭐]/gu)).length)
        : null;
      const n = stars ?? parseLocaleNumber(trimmed, locale);
      if (n === null) return { ok: false, reason: 'invalid' };
      if (column.type === 'rating') {
        const max = typeof column.settings.max === 'number' ? column.settings.max : 5;
        if (!/^\d+$/.test(n) || Number(n) > max) return { ok: false, reason: 'invalid' };
      }
      return validate(column.type, { n });
    }
    case 'status': {
      const { ids, unknown } = matchByName(column.labels ?? [], [trimmed], (label) => [
        label.label,
      ]);
      const labelId = ids[0];
      return labelId === undefined
        ? { ok: false, reason: 'unknown_label', unknown }
        : { ok: true, value: { labelId } };
    }
    case 'dropdown': {
      const wanted = column.settings.multiple === true ? splitList(trimmed) : [trimmed];
      const { ids, unknown } = matchByName(column.options ?? [], wanted, (option) => [
        option.label,
      ]);
      return unknown.length > 0
        ? { ok: false, reason: 'unknown_option', unknown }
        : { ok: true, value: { optionIds: ids } };
    }
    case 'people': {
      const wanted = splitList(trimmed);
      const people = matchByName(directory.people, wanted, (person) => [person.name, person.email]);
      const teams = matchByName(directory.teams, people.unknown, (team) => [team.name]);
      return teams.unknown.length > 0
        ? { ok: false, reason: 'unknown_person', unknown: teams.unknown }
        : { ok: true, value: { personIds: people.ids, teamIds: teams.ids } };
    }
    case 'board_relation': {
      const { ids, unknown } = matchByName(directory.items ?? [], splitList(trimmed), (item) => [
        item.name,
      ]);
      return unknown.length > 0
        ? { ok: false, reason: 'unknown_item', unknown }
        : { ok: true, value: { itemIds: ids } };
    }
    case 'tags':
      return validate('tags', { tags: [...new Set(splitList(trimmed))] });
    case 'date': {
      const date = parseLocaleDate(trimmed, locale);
      if (date === null) return { ok: false, reason: 'invalid' };
      const includeTime = column.settings.includeTime === true;
      return validate('date', includeTime && date.time !== undefined ? date : { d: date.d });
    }
    case 'timeline':
    case 'week': {
      const parts = trimmed.split(/\s*(?:→|->|–|—| a | to | - )\s*/);
      const from = parseLocaleDate(parts[0] ?? '', locale);
      const to = parseLocaleDate(parts[1] ?? parts[0] ?? '', locale);
      if (from === null || to === null || to.d < from.d) return { ok: false, reason: 'invalid' };
      return validate(column.type, { from: from.d, to: to.d });
    }
    case 'link': {
      const labelled = /^(.*?)\s*[(<](https?:\/\/[^)>\s]+)[)>]$/.exec(trimmed);
      if (labelled !== null)
        return validate('link', {
          url: labelled[2],
          ...(labelled[1] === '' ? {} : { text: labelled[1] }),
        });
      const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      return validate('link', { url });
    }
    case 'email':
      return validate('email', { email: trimmed.toLowerCase() });
    case 'phone':
      return validate('phone', { phone: trimmed });
    case 'location':
      return validate('location', { address: trimmed });
    case 'color':
      return validate('color', { color: trimmed.startsWith('#') ? trimmed : `#${trimmed}` });
    case 'hour': {
      const match = /^(\d{1,2})[:h](\d{2})$/.exec(trimmed);
      return match === null
        ? { ok: false, reason: 'invalid' }
        : validate('hour', { time: `${pad(Number(match[1]))}:${match[2] ?? '00'}` });
    }
    case 'country':
      return validate('country', { code: trimmed.toUpperCase() });
    default:
      return { ok: false, reason: 'read_only' };
  }
}

export interface CellTextItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface FormatCellOptions {
  locale?: CellTextLocale;
  /** Inclui a unidade de colunas numéricas (exibição/exportação); a cópia omite para colar no Excel. */
  withUnit?: boolean;
  /** Item (para colunas de sistema: criado por, última atualização, ID). */
  item?: CellTextItem;
}

function personName(directory: CellTextDirectory, id: string | null | undefined): string {
  if (id === null || id === undefined) return '';
  return directory.people.find((person) => person.id === id)?.name ?? '';
}

function formatNumber(column: CellTextColumn, n: string, options: FormatCellOptions): string {
  const decimals =
    typeof column.settings.decimals === 'number' ? column.settings.decimals : undefined;
  const text = formatDecimalText(n, options.locale, decimals);
  const unit = typeof column.settings.unit === 'string' ? column.settings.unit : '';
  if (options.withUnit !== true || unit === '') return text;
  return column.settings.unitPosition === 'prefix' ? `${unit} ${text}` : `${text} ${unit}`;
}

/** Texto de uma célula (copiar, exportar, buscar). Valores vazios viram string vazia. */
export function formatCellText(
  column: CellTextColumn,
  raw: unknown,
  directory: CellTextDirectory = EMPTY_DIRECTORY,
  options: FormatCellOptions = {},
): string {
  const locale = options.locale ?? 'pt-BR';
  const item = options.item;
  switch (column.type) {
    case 'item_id':
      return item?.id ?? '';
    case 'creation_log':
      return item === undefined
        ? ''
        : [personName(directory, item.createdBy), formatLocaleDate(item.createdAt, locale)]
            .filter((part) => part !== '')
            .join(' · ');
    case 'last_updated':
      return item === undefined
        ? ''
        : [personName(directory, item.updatedBy), formatLocaleDate(item.updatedAt, locale)]
            .filter((part) => part !== '')
            .join(' · ');
    default:
      break;
  }
  if (typeof raw !== 'object' || raw === null) return '';
  const value = raw as Record<string, unknown>;
  const str = (key: string) => {
    const entry = value[key];
    return typeof entry === 'string' ? entry : '';
  };
  const list = (key: string) =>
    Array.isArray(value[key]) ? (value[key] as unknown[]).map(String) : [];
  switch (column.type) {
    case 'text':
    case 'long_text':
      return str('text');
    case 'number':
    case 'rating':
    case 'time_tracking':
      return str('n') === '' ? '' : formatNumber(column, str('n'), { ...options, locale });
    case 'formula':
    case 'mirror':
    case 'rollup':
    case 'progress': {
      if (str('n') !== '')
        return column.type === 'progress'
          ? `${formatDecimalText(str('n'), locale, 0)}%`
          : formatNumber(column, str('n'), { ...options, locale });
      if (str('d') !== '') return formatLocaleDate(str('d'), locale);
      return str('text');
    }
    case 'status':
      return column.labels?.find((label) => label.id === str('labelId'))?.label ?? '';
    case 'dropdown':
      return list('optionIds')
        .map((id) => column.options?.find((option) => option.id === id)?.label ?? '')
        .filter((label) => label !== '')
        .join(', ');
    case 'people':
      return [
        ...list('personIds').map((id) => personName(directory, id)),
        ...list('teamIds').map((id) => directory.teams.find((team) => team.id === id)?.name ?? ''),
      ]
        .filter((name) => name !== '')
        .join(', ');
    case 'board_relation':
      return list('itemIds')
        .map((id) => directory.items?.find((entry) => entry.id === id)?.name ?? '')
        .filter((name) => name !== '')
        .join(', ');
    case 'tags':
      return list('tags').join(', ');
    case 'date': {
      if (str('d') === '') return '';
      const date = formatLocaleDate(str('d'), locale);
      return str('time') === '' ? date : `${date} ${str('time')}`;
    }
    case 'timeline':
    case 'week':
      return str('from') === ''
        ? ''
        : `${formatLocaleDate(str('from'), locale)} - ${formatLocaleDate(str('to'), locale)}`;
    case 'checkbox':
      return value.checked === true ? (locale === 'en' ? 'Yes' : 'Sim') : '';
    case 'link':
      return str('text') === '' ? str('url') : `${str('text')} (${str('url')})`;
    case 'email':
      return str('email');
    case 'phone':
      return str('phone');
    case 'location':
      return str('address');
    case 'color':
      return str('color');
    case 'hour':
      return str('time');
    case 'country':
      return str('code');
    case 'auto_id':
      return str('text');
    case 'file':
      return String(list('attachmentIds').length || '');
    case 'vote':
      return String(list('userIds').length || '');
    default:
      return '';
  }
}
