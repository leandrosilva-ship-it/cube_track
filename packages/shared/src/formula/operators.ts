import type { FormulaBinaryOperator } from './ast.js';
import { addDays, dateToMs, isValidDatetime, msToDatetime, parseDateText } from './dates.js';
import {
  booleanValue,
  dateValue,
  Dec,
  EMPTY,
  formulaError,
  isError,
  numberValue,
  parseNumericText,
  RESULT_PRECISION,
  textValue,
  toInstant,
  toNumber,
  toText,
  unwrap,
} from './values.js';
import type { FormulaError, Value } from './values.js';

/** Semântica dos operadores (aritmética decimal, datas, concatenação e comparação). */

const DAY_MS = 86_400_000;

function isTemporal(value: Value): boolean {
  return value.kind === 'date' || value.kind === 'datetime';
}

/** Desloca data/data-hora em `days` dias (datas ignoram a fração, truncando em direção ao zero). */
function shiftTemporal(value: Value, days: Dec): Value {
  if (value.kind === 'date') {
    const whole = days.toDecimalPlaces(0, Dec.ROUND_DOWN);
    if (whole.abs().gt(3_700_000)) return dateValue(null);
    return dateValue(addDays(value.value, whole.toNumber()));
  }
  const instant = toInstant(value);
  if (instant === null) return formulaError('#VALUE!', 'Data-hora inválida');
  const offset = days.times(DAY_MS).toDecimalPlaces(0);
  if (offset.abs().gt(400_000 * DAY_MS))
    return formulaError('#NUM!', 'Data fora do intervalo suportado');
  const shifted = msToDatetime(instant + offset.toNumber());
  return shifted === null
    ? formulaError('#NUM!', 'Data fora do intervalo suportado')
    : { kind: 'datetime', value: shifted };
}

function temporalArithmetic(operator: '+' | '-', left: Value, right: Value): Value {
  // Data combinada com vazio não tem resultado conhecido: propaga vazio.
  if (left.kind === 'empty' || right.kind === 'empty') return EMPTY;
  if (isTemporal(left) && isTemporal(right)) {
    if (operator === '+') return formulaError('#VALUE!', 'Não é possível somar duas datas');
    const start = toInstant(right);
    const end = toInstant(left);
    if (start === null || end === null) return formulaError('#VALUE!', 'Data inválida');
    return numberValue(new Dec(end - start).div(DAY_MS));
  }
  if (isTemporal(left)) {
    const days = toNumber(right);
    if (isError(days)) return days;
    return shiftTemporal(left, operator === '-' ? days.neg() : days);
  }
  if (operator === '-')
    return formulaError('#VALUE!', 'Não é possível subtrair uma data de um número');
  const days = toNumber(left);
  if (isError(days)) return days;
  return shiftTemporal(right, days);
}

export function power(base: Dec, exponent: Dec): Value {
  if (base.isZero()) {
    if (exponent.isZero()) return formulaError('#NUM!', '0 elevado a 0 é indefinido');
    if (exponent.isNegative()) return formulaError('#DIV/0!', 'Divisão por zero');
  }
  if (base.isNegative() && !exponent.isInteger()) {
    return formulaError('#NUM!', 'Base negativa com expoente fracionário');
  }
  return numberValue(base.pow(exponent));
}

export function arithmetic(
  operator: '+' | '-' | '*' | '/' | '^',
  leftInput: Value,
  rightInput: Value,
): Value {
  const left = unwrap(leftInput);
  const right = unwrap(rightInput);
  if (isError(left)) return left;
  if (isError(right)) return right;
  if ((operator === '+' || operator === '-') && (isTemporal(left) || isTemporal(right))) {
    return temporalArithmetic(operator, left, right);
  }
  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  switch (operator) {
    case '+':
      return numberValue(a.plus(b));
    case '-':
      return numberValue(a.minus(b));
    case '*':
      return numberValue(a.times(b));
    case '/':
      return b.isZero() ? formulaError('#DIV/0!', 'Divisão por zero') : numberValue(a.div(b));
    case '^':
      return power(a, b);
  }
}

export function negate(input: Value): Value {
  const number = toNumber(input);
  return isError(number) ? number : numberValue(number.neg());
}

export function percent(input: Value): Value {
  const number = toNumber(input);
  return isError(number) ? number : numberValue(number.div(100));
}

export function concatenate(left: Value, right: Value): Value {
  const a = toText(left);
  if (isError(a)) return a;
  const b = toText(right);
  if (isError(b)) return b;
  return textValue(a + b);
}

const TYPE_RANK = { number: 0, date: 1, datetime: 1, text: 2, boolean: 3 } as const;
const collator = new Intl.Collator('pt-BR', { sensitivity: 'accent' });

function sign(value: number): number {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

function compareDecimals(a: Dec, b: Dec): number {
  return a.toSignificantDigits(RESULT_PRECISION).cmp(b.toSignificantDigits(RESULT_PRECISION));
}

function textInstant(text: string): number | null {
  const value = text.trim();
  if (isValidDatetime(value)) return Date.parse(value);
  const date = parseDateText(value);
  return date === null ? null : dateToMs(date);
}

type Scalar = Exclude<Value, { kind: 'list' } | { kind: 'empty' } | FormulaError>;

/** Ordenação no estilo Excel; tipos incomparáveis seguem número < data < texto < lógico. */
function compareScalars(a: Scalar, b: Scalar): number {
  if (isTemporal(a) || isTemporal(b)) {
    const left = a.kind === 'text' ? textInstant(a.value) : toInstant(a);
    const right = b.kind === 'text' ? textInstant(b.value) : toInstant(b);
    if (left !== null && right !== null) return sign(left - right);
  }
  if (a.kind === 'number' && b.kind === 'number') {
    return compareDecimals(new Dec(a.value), new Dec(b.value));
  }
  // Texto numérico comparado a número é lido como número (dados de board costumam vir como texto).
  if (a.kind === 'number' && b.kind === 'text') {
    const parsed = parseNumericText(b.value);
    if (parsed) return compareDecimals(new Dec(a.value), parsed);
  }
  if (a.kind === 'text' && b.kind === 'number') {
    const parsed = parseNumericText(a.value);
    if (parsed) return compareDecimals(parsed, new Dec(b.value));
  }
  if (a.kind === 'text' && b.kind === 'text') return sign(collator.compare(a.value, b.value));
  if (a.kind === 'boolean' && b.kind === 'boolean') return Number(a.value) - Number(b.value);
  return sign(TYPE_RANK[a.kind] - TYPE_RANK[b.kind]);
}

function emptyCounterpart(other: Scalar): Scalar | null {
  switch (other.kind) {
    case 'number':
      return { kind: 'number', value: '0' };
    case 'text':
      return { kind: 'text', value: '' };
    case 'boolean':
      return { kind: 'boolean', value: false };
    case 'date':
    case 'datetime':
      return null;
  }
}

function compareEmptyTo(other: Scalar): number {
  const counterpart = emptyCounterpart(other);
  return counterpart === null ? -1 : compareScalars(counterpart, other);
}

function toScalar(value: Value): Scalar | 'empty' | FormulaError {
  if (value.kind === 'empty') return 'empty';
  if (value.kind === 'list') {
    const text = toText(value);
    return isError(text) ? text : { kind: 'text', value: text };
  }
  return value;
}

/** Compara dois valores (-1, 0, 1). Vazio equivale ao "zero" do outro tipo e precede datas. */
export function compareValues(leftInput: Value, rightInput: Value): number | FormulaError {
  const left = toScalar(unwrap(leftInput));
  const right = toScalar(unwrap(rightInput));
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (left === 'empty') return right === 'empty' ? 0 : compareEmptyTo(right);
  if (right === 'empty') return -compareEmptyTo(left);
  return compareScalars(left, right);
}

export function comparison(
  operator: '=' | '<>' | '<' | '>' | '<=' | '>=',
  left: Value,
  right: Value,
): Value {
  const order = compareValues(left, right);
  if (isError(order)) return order;
  switch (operator) {
    case '=':
      return booleanValue(order === 0);
    case '<>':
      return booleanValue(order !== 0);
    case '<':
      return booleanValue(order < 0);
    case '>':
      return booleanValue(order > 0);
    case '<=':
      return booleanValue(order <= 0);
    case '>=':
      return booleanValue(order >= 0);
  }
}

export function applyBinary(operator: FormulaBinaryOperator, left: Value, right: Value): Value {
  switch (operator) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '^':
      return arithmetic(operator, left, right);
    case '&':
      return concatenate(left, right);
    default:
      return comparison(operator, left, right);
  }
}
