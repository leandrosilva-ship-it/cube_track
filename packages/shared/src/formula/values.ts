import DecimalModule from 'decimal.js-light';
import type { Decimal as DecimalInstance } from 'decimal.js-light';

import { datetimeToDate, datetimeToMs, dateToMs, isValidDate, parseDateText } from './dates.js';

/**
 * Valores, erros e coerções das fórmulas. Números trafegam como string decimal e são operados com
 * `decimal.js-light` (nunca `float`).
 */

// O default import entrega o construtor tanto no Node (CJS) quanto em bundlers (ESM);
// a tipagem sob NodeNext o descreve como o namespace do módulo.
const BaseDecimal = DecimalModule as unknown as typeof DecimalInstance;

/** Construtor local: 40 dígitos significativos internos e arredondamento "metade para longe do zero". */
export const Dec = BaseDecimal.clone({
  precision: 40,
  rounding: BaseDecimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});
export type Dec = DecimalInstance;

/** Dígitos significativos dos números entregues como resultado final. */
export const RESULT_PRECISION = 30;
/** Magnitude máxima aceita; acima disso o resultado é `#NUM!`. */
const MAX_MAGNITUDE = new Dec('1e100');

export type FormulaValue =
  | { kind: 'number'; value: string }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'datetime'; value: string }
  | { kind: 'list'; items: FormulaValue[] }
  | { kind: 'empty' };

export type FormulaErrorCode =
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#N/A'
  | '#NUM!'
  | '#ERROR!';

export interface FormulaError {
  kind: 'error';
  code: FormulaErrorCode;
  message: string;
}

export type FormulaResult = Exclude<FormulaValue, { kind: 'list' }> | FormulaError;

/** Valor intermediário durante a avaliação. */
export type Value = FormulaValue | FormulaError;

export const EMPTY: Value = { kind: 'empty' };
export const TRUE: Value = { kind: 'boolean', value: true };
export const FALSE: Value = { kind: 'boolean', value: false };

export function formulaError(code: FormulaErrorCode, message: string): FormulaError {
  return { kind: 'error', code, message };
}

export function isError(value: unknown): value is FormulaError {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'error';
}

export function booleanValue(value: boolean): Value {
  return value ? TRUE : FALSE;
}

export function textValue(value: string): Value {
  return { kind: 'text', value };
}

/** Decimal de uma string numérica; `null` quando a string não é um número válido. */
export function parseDecimal(value: string): Dec | null {
  try {
    return new Dec(value);
  } catch {
    return null;
  }
}

/** Converte o decimal em valor numérico, rejeitando magnitudes fora do intervalo suportado. */
export function numberValue(value: Dec): Value {
  if (value.abs().gt(MAX_MAGNITUDE)) {
    return formulaError('#NUM!', 'Número fora do intervalo suportado');
  }
  return { kind: 'number', value: value.isZero() ? '0' : value.toString() };
}

export function dateValue(value: string | null): Value {
  return value === null
    ? formulaError('#NUM!', 'Data fora do intervalo suportado')
    : { kind: 'date', value };
}

/** Lista com um único item vale como o próprio item. */
export function unwrap(value: Value): Value {
  if (value.kind === 'list' && value.items.length === 1 && value.items[0]) {
    return unwrap(value.items[0]);
  }
  if (value.kind === 'list' && value.items.length === 0) return EMPTY;
  return value;
}

/** Achata listas (recursivamente) em itens simples. */
export function flatten(value: Value): Value[] {
  if (value.kind !== 'list') return [value];
  return value.items.flatMap((item) => flatten(item));
}

/** Primeiro erro encontrado em um valor (inclusive dentro de listas). */
export function findError(values: readonly Value[]): FormulaError | null {
  for (const value of values) {
    for (const item of flatten(value)) if (isError(item)) return item;
  }
  return null;
}

const CANONICAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const COMMA_DECIMAL = /^[+-]?\d+,\d+$/;
const BR_GROUPED = /^[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const EN_GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/**
 * Interpreta texto numérico. Ordem: formato canônico (`1234.5`, `1e3`), vírgula decimal (`12,5`),
 * milhar pt-BR (`1.234,5`) e milhar en (`1,234.5`). `1.234` é lido como 1,234 (formato canônico).
 */
export function parseNumericText(text: string): Dec | null {
  const value = text.trim();
  try {
    if (CANONICAL_NUMBER.test(value)) return new Dec(value.replace(/^\+/, ''));
    if (COMMA_DECIMAL.test(value)) return new Dec(value.replace(/^\+/, '').replace(',', '.'));
    if (BR_GROUPED.test(value)) {
      return new Dec(value.replace(/^\+/, '').replaceAll('.', '').replace(',', '.'));
    }
    if (EN_GROUPED.test(value)) return new Dec(value.replace(/^\+/, '').replaceAll(',', ''));
  } catch {
    return null;
  }
  return null;
}

function describe(value: Value): string {
  const text = toText(value);
  return isError(text) ? value.kind : `"${text}"`;
}

/** Coerção para número: vazio → 0, booleano → 1/0, texto numérico → número. */
export function toNumber(input: Value): Dec | FormulaError {
  const value = unwrap(input);
  switch (value.kind) {
    case 'error':
      return value;
    case 'number':
      return (
        parseDecimal(value.value) ?? formulaError('#VALUE!', `Número inválido "${value.value}"`)
      );
    case 'boolean':
      return new Dec(value.value ? 1 : 0);
    case 'empty':
      return new Dec(0);
    case 'text': {
      if (value.value.trim() === '') return new Dec(0);
      const parsed = parseNumericText(value.value);
      return parsed ?? formulaError('#VALUE!', `Valor ${describe(value)} não é um número`);
    }
    case 'list':
      return formulaError('#VALUE!', 'Lista com vários valores não pode ser usada como número');
    case 'date':
    case 'datetime':
      return formulaError('#VALUE!', `Data ${describe(value)} não pode ser usada como número`);
  }
}

/** Coerção para inteiro (trunca a parte decimal, como o Excel). */
export function toInteger(input: Value): number | FormulaError {
  const number = toNumber(input);
  if (isError(number)) return number;
  const truncated = number.toDecimalPlaces(0, Dec.ROUND_DOWN);
  if (truncated.abs().gt(Number.MAX_SAFE_INTEGER)) {
    return formulaError('#NUM!', 'Número inteiro fora do intervalo suportado');
  }
  return truncated.toNumber();
}

/** Texto canônico de um número (sem zeros à direita). */
export function numberToText(value: string): string {
  const decimal = parseDecimal(value);
  if (decimal === null) return value;
  return decimal.isZero() ? '0' : decimal.toString();
}

/** Coerção para texto: números canônicos, datas ISO, booleanos TRUE/FALSE, listas unidas por ", ". */
export function toText(input: Value): string | FormulaError {
  switch (input.kind) {
    case 'error':
      return input;
    case 'number':
      return numberToText(input.value);
    case 'text':
    case 'date':
    case 'datetime':
      return input.value;
    case 'boolean':
      return input.value ? 'TRUE' : 'FALSE';
    case 'empty':
      return '';
    case 'list': {
      const parts: string[] = [];
      for (const item of input.items) {
        const text = toText(item);
        if (isError(text)) return text;
        if (text !== '') parts.push(text);
      }
      return parts.join(', ');
    }
  }
}

const TRUE_TEXTS = new Set(['true', 'verdadeiro']);
const FALSE_TEXTS = new Set(['false', 'falso', '']);

/** Coerção lógica: vazio → FALSE, número ≠ 0 → TRUE, textos TRUE/FALSE/VERDADEIRO/FALSO. */
export function toBoolean(input: Value): boolean | FormulaError {
  const value = unwrap(input);
  switch (value.kind) {
    case 'error':
      return value;
    case 'boolean':
      return value.value;
    case 'empty':
      return false;
    case 'number': {
      const number = parseDecimal(value.value);
      return number === null
        ? formulaError('#VALUE!', `Número inválido "${value.value}"`)
        : !number.isZero();
    }
    case 'text': {
      const normalized = value.value.trim().toLowerCase();
      if (TRUE_TEXTS.has(normalized)) return true;
      if (FALSE_TEXTS.has(normalized)) return false;
      return formulaError('#VALUE!', `Valor ${describe(value)} não é lógico`);
    }
    case 'list':
      return formulaError('#VALUE!', 'Lista com vários valores não pode ser usada como lógico');
    case 'date':
    case 'datetime':
      return formulaError('#VALUE!', `Data ${describe(value)} não é lógico`);
  }
}

/**
 * Coerção para data de negócio. Retorna `null` para vazio (funções de data propagam vazio);
 * data-hora usa a data UTC; textos aceitam ISO e `DD/MM/YYYY`.
 */
export function toDate(input: Value): string | FormulaError | null {
  const value = unwrap(input);
  switch (value.kind) {
    case 'error':
      return value;
    case 'empty':
      return null;
    case 'date':
      return isValidDate(value.value)
        ? value.value
        : formulaError('#VALUE!', `Data inválida "${value.value}"`);
    case 'datetime':
      return (
        datetimeToDate(value.value) ??
        formulaError('#VALUE!', `Data-hora inválida "${value.value}"`)
      );
    case 'text':
      if (value.value.trim() === '') return null;
      return (
        parseDateText(value.value) ??
        formulaError('#VALUE!', `Valor ${describe(value)} não é uma data`)
      );
    case 'number':
    case 'boolean':
    case 'list':
      return formulaError('#VALUE!', `Valor ${describe(value)} não é uma data`);
  }
}

/** Instante (ms) de data ou data-hora, para comparações e aritmética mista. */
export function toInstant(value: Value): number | null {
  if (value.kind === 'date' && isValidDate(value.value)) return dateToMs(value.value);
  if (value.kind === 'datetime') {
    const ms = datetimeToMs(value.value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/** Valor de entrada (resolvido de coluna) ou resultado final, normalizado para a saída. */
export function toResult(input: Value): FormulaResult {
  switch (input.kind) {
    case 'list': {
      const text = toText(input);
      return isError(text) ? text : { kind: 'text', value: text };
    }
    case 'number': {
      const value = parseDecimal(input.value);
      if (value === null) return formulaError('#VALUE!', `Número inválido "${input.value}"`);
      const rounded = value.toSignificantDigits(RESULT_PRECISION);
      return { kind: 'number', value: rounded.isZero() ? '0' : rounded.toString() };
    }
    default:
      return input;
  }
}

/** Representação textual para armazenamento/exibição. */
export function formulaResultToText(result: FormulaResult): string {
  switch (result.kind) {
    case 'number':
      return numberToText(result.value);
    case 'boolean':
      return result.value ? 'true' : 'false';
    case 'error':
      return result.code;
    case 'empty':
      return '';
    case 'text':
    case 'date':
    case 'datetime':
      return result.value;
  }
}
