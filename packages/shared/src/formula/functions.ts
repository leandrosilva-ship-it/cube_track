import { addBusinessDays, businessDaysBetween, isoWeekday } from '../business-days.js';
import type { FormulaFunction, FunctionScope } from './context.js';
import {
  addDays,
  addMonths,
  dateParts,
  daysBetween,
  endOfMonth,
  formatDate,
  isoWeekNumber,
  isValidDate,
  isValidDatetime,
  makeDate,
} from './dates.js';
import { compareValues, power } from './operators.js';
import {
  booleanValue,
  dateValue,
  Dec,
  EMPTY,
  FALSE,
  findError,
  flatten,
  formulaError,
  isError,
  numberValue,
  parseNumericText,
  textValue,
  toBoolean,
  toDate,
  toInstant,
  toInteger,
  toNumber,
  toText,
  unwrap,
} from './values.js';
import type { FormulaError, Value } from './values.js';

/** Implementações das funções do catálogo (`catalog.ts`), indexadas pelo nome em maiúsculas. */

/** Limite de dias percorridos por WORKDAYS/ADD_WORKDAYS (100 anos), protegendo o servidor. */
const MAX_WORKDAY_SPAN = 36_600;
/** Tamanho máximo de texto gerado por REPT (mesmo limite de célula do Excel). */
const MAX_TEXT_LENGTH = 32_767;
const MAX_DECIMALS = 30;

type EagerFunction = (values: Value[], scope: FunctionScope) => Value;

/** Avalia todos os argumentos antes; o primeiro erro encontrado é propagado. */
function eager(implementation: EagerFunction): FormulaFunction {
  return (args, scope) => {
    const values = args.map((arg) => scope.evaluate(arg));
    return findError(values) ?? implementation(values, scope);
  };
}

function arg(values: readonly Value[], index: number): Value {
  return values[index] ?? EMPTY;
}

function divisionByZero(): FormulaError {
  return formulaError('#DIV/0!', 'Divisão por zero');
}

// ---------- Lógicas ----------

function isBlank(value: Value): boolean {
  const single = unwrap(value);
  return single.kind === 'empty' || (single.kind === 'text' && single.value === '');
}

function hasError(value: Value): boolean {
  return findError([value]) !== null;
}

const IF: FormulaFunction = ([condition, whenTrue, whenFalse], scope) => {
  if (!condition || !whenTrue) return formulaError('#ERROR!', 'Argumentos insuficientes');
  const test = toBoolean(scope.evaluate(condition));
  if (isError(test)) return test;
  if (test) return scope.evaluate(whenTrue);
  // Sem o terceiro argumento, o Excel devolve FALSO.
  return whenFalse ? scope.evaluate(whenFalse) : FALSE;
};

const IFS: FormulaFunction = (args, scope) => {
  for (let index = 0; index + 1 < args.length; index += 2) {
    const condition = args[index];
    const value = args[index + 1];
    if (!condition || !value) break;
    const test = toBoolean(scope.evaluate(condition));
    if (isError(test)) return test;
    if (test) return scope.evaluate(value);
  }
  return formulaError('#N/A', 'Nenhuma condição de IFS é verdadeira');
};

const SWITCH: FormulaFunction = ([expression, ...rest], scope) => {
  if (!expression) return formulaError('#ERROR!', 'Argumentos insuficientes');
  const value = scope.evaluate(expression);
  if (hasError(value)) return value;
  for (let index = 0; index + 1 < rest.length; index += 2) {
    const candidate = rest[index];
    const result = rest[index + 1];
    if (!candidate || !result) break;
    const order = compareValues(value, scope.evaluate(candidate));
    if (isError(order)) return order;
    if (order === 0) return scope.evaluate(result);
  }
  const fallback = rest.length % 2 === 1 ? rest[rest.length - 1] : undefined;
  return fallback
    ? scope.evaluate(fallback)
    : formulaError('#N/A', 'Nenhum caso de SWITCH corresponde ao valor');
};

function logicalItems(values: readonly Value[]): boolean[] | FormulaError {
  const items: boolean[] = [];
  for (const item of values.flatMap((value) => flatten(value))) {
    const test = toBoolean(item);
    if (isError(test)) return test;
    items.push(test);
  }
  return items;
}

function logical(reducer: (items: boolean[]) => boolean): FormulaFunction {
  return eager((values) => {
    const items = logicalItems(values);
    return isError(items) ? items : booleanValue(items.length > 0 && reducer(items));
  });
}

const IFERROR: FormulaFunction = ([value, fallback], scope) => {
  if (!value || !fallback) return formulaError('#ERROR!', 'Argumentos insuficientes');
  const result = scope.evaluate(value);
  return hasError(result) ? scope.evaluate(fallback) : result;
};

const ISERROR: FormulaFunction = ([value], scope) =>
  booleanValue(value ? hasError(scope.evaluate(value)) : false);

const ISBLANK: FormulaFunction = ([value], scope) =>
  booleanValue(value ? isBlank(scope.evaluate(value)) : true);

const ISNUMBER: FormulaFunction = ([value], scope) =>
  booleanValue(value ? unwrap(scope.evaluate(value)).kind === 'number' : false);

// ---------- Matemáticas ----------

/**
 * Números dos argumentos: argumentos diretos são convertidos (texto não numérico => `#VALUE!`);
 * itens de listas (colunas multivaloradas) que não são numéricos são ignorados, como intervalos no
 * Excel. Vazios são ignorados.
 */
function collectNumbers(values: readonly Value[]): Dec[] | FormulaError {
  const numbers: Dec[] = [];
  for (const value of values) {
    if (value.kind === 'list') {
      for (const item of flatten(value)) {
        if (item.kind === 'number') numbers.push(new Dec(item.value));
        if (item.kind === 'text') {
          const parsed = parseNumericText(item.value);
          if (parsed) numbers.push(parsed);
        }
      }
      continue;
    }
    if (value.kind === 'empty') continue;
    const number = toNumber(value);
    if (isError(number)) return number;
    numbers.push(number);
  }
  return numbers;
}

function aggregate(reducer: (numbers: Dec[]) => Value): FormulaFunction {
  return eager((values) => {
    const numbers = collectNumbers(values);
    return isError(numbers) ? numbers : reducer(numbers);
  });
}

function sum(numbers: readonly Dec[]): Dec {
  return numbers.reduce((total, number) => total.plus(number), new Dec(0));
}

const AVERAGE = aggregate((numbers) =>
  numbers.length === 0 ? divisionByZero() : numberValue(sum(numbers).div(numbers.length)),
);

/** MIN/MAX: se todos os valores forem datas, devolve a data extrema; senão, compara números. */
function extreme(direction: 1 | -1): FormulaFunction {
  return eager((values) => {
    const items = values.flatMap((value) => flatten(value)).filter((item) => item.kind !== 'empty');
    const temporal = items.length > 0 && items.every((item) => toInstant(item) !== null);
    if (temporal) {
      return items.reduce((best, item) =>
        ((toInstant(item) ?? 0) - (toInstant(best) ?? 0)) * direction > 0 ? item : best,
      );
    }
    const numbers = collectNumbers(values);
    if (isError(numbers)) return numbers;
    const [first, ...rest] = numbers;
    if (!first) return numberValue(new Dec(0));
    return numberValue(rest.reduce((best, n) => (n.cmp(best) * direction > 0 ? n : best), first));
  });
}

/** COUNT ignora erros e conta apenas números. */
const COUNT: FormulaFunction = (args, scope) => {
  const items = args.flatMap((node) => flatten(scope.evaluate(node)));
  return numberValue(new Dec(items.filter((item) => item.kind === 'number').length));
};

/** COUNTA conta valores não vazios (erros incluídos, como no Excel). */
const COUNTA: FormulaFunction = (args, scope) => {
  const items = args.flatMap((node) => flatten(scope.evaluate(node)));
  return numberValue(new Dec(items.filter((item) => !isBlank(item)).length));
};

function roundTo(value: Dec, digits: number, mode: number): Dec {
  if (digits >= 0) return value.toDecimalPlaces(Math.min(digits, 100), mode);
  const factor = new Dec(10).pow(Math.min(-digits, 100));
  return value.div(factor).toDecimalPlaces(0, mode).times(factor);
}

function rounding(mode: number): FormulaFunction {
  return eager((values) => {
    const number = toNumber(arg(values, 0));
    if (isError(number)) return number;
    const digits = toInteger(arg(values, 1));
    if (isError(digits)) return digits;
    return numberValue(roundTo(number, digits, mode));
  });
}

function unaryMath(operation: (number: Dec) => Value): FormulaFunction {
  return eager((values) => {
    const number = toNumber(arg(values, 0));
    return isError(number) ? number : operation(number);
  });
}

function binaryMath(operation: (a: Dec, b: Dec) => Value): FormulaFunction {
  return eager((values) => {
    const a = toNumber(arg(values, 0));
    if (isError(a)) return a;
    const b = toNumber(arg(values, 1));
    return isError(b) ? b : operation(a, b);
  });
}

/** Múltiplo opcional (padrão 1). */
function significanceOf(values: readonly Value[]): Dec | FormulaError {
  return values.length > 1 ? toNumber(arg(values, 1)) : new Dec(1);
}

/**
 * CEILING/FLOOR do Excel: múltiplo positivo arredonda para +∞ (CEILING) ou −∞ (FLOOR);
 * número e múltiplo negativos arredondam para longe do zero (CEILING) ou para o zero (FLOOR).
 */
function multipleRounding(kind: 'ceiling' | 'floor'): FormulaFunction {
  return eager((values) => {
    const number = toNumber(arg(values, 0));
    if (isError(number)) return number;
    const significance = significanceOf(values);
    if (isError(significance)) return significance;
    if (significance.isZero())
      return kind === 'ceiling' ? numberValue(new Dec(0)) : divisionByZero();
    if (number.isPositive() && !number.isZero() && significance.isNegative()) {
      return formulaError('#NUM!', 'Número positivo exige múltiplo positivo');
    }
    // O quociente é positivo quando número e múltiplo têm o mesmo sinal: teto/piso do quociente dá
    // "para longe do zero"/"para o zero" nos negativos, como no Excel.
    const mode = kind === 'ceiling' ? Dec.ROUND_CEIL : Dec.ROUND_FLOOR;
    return numberValue(number.div(significance).toDecimalPlaces(0, mode).times(significance));
  });
}

// ---------- Datas ----------

type DateArg = string | null | FormulaError;

function dateFunction(operation: (date: string, values: Value[], scope: FunctionScope) => Value) {
  return eager((values, scope) => {
    const date: DateArg = toDate(arg(values, 0));
    if (date === null) return EMPTY;
    return isError(date) ? date : operation(date, values, scope);
  });
}

function datePart(read: (date: string) => number): FormulaFunction {
  return dateFunction((date) => numberValue(new Dec(read(date))));
}

function twoDates(operation: (first: string, second: string, scope: FunctionScope) => Value) {
  return eager((values, scope) => {
    const first = toDate(arg(values, 0));
    if (isError(first)) return first;
    const second = toDate(arg(values, 1));
    if (isError(second)) return second;
    if (first === null || second === null) return EMPTY;
    return operation(first, second, scope);
  });
}

function boundedInteger(value: Value, limit: number): number | FormulaError {
  const integer = toInteger(value);
  if (isError(integer)) return integer;
  return Math.abs(integer) > limit
    ? formulaError('#NUM!', 'Valor fora do intervalo suportado')
    : integer;
}

function dateShift(
  shift: (date: string, amount: number, scope: FunctionScope) => Value,
  limit: number,
) {
  return dateFunction((date, values, scope) => {
    const amount = boundedInteger(arg(values, 1), limit);
    return isError(amount) ? amount : shift(date, amount, scope);
  });
}

/** Dias úteis inclusivos entre duas datas (como NETWORKDAYS); negativo se o início for posterior. */
const WORKDAYS = twoDates((start, end, { context }) => {
  if (Math.abs(daysBetween(start, end)) > MAX_WORKDAY_SPAN) {
    return formulaError('#NUM!', 'Intervalo de datas muito longo');
  }
  // `businessDaysBetween` devolve 0 quando o fim é anterior; invertemos para manter o sinal.
  return start <= end
    ? numberValue(new Dec(businessDaysBetween(start, end, context.calendar)))
    : numberValue(new Dec(-businessDaysBetween(end, start, context.calendar)));
});

const ADD_WORKDAYS = dateShift((date, amount, { context }) => {
  if (context.calendar.workingDays.length === 0) {
    return formulaError('#NUM!', 'Calendário sem dias úteis');
  }
  return dateValue(addBusinessDays(date, amount, context.calendar));
}, MAX_WORKDAY_SPAN);

const DATE = eager((values) => {
  const parts: number[] = [];
  for (const value of values) {
    const part = boundedInteger(value, 99_999);
    if (isError(part)) return part;
    parts.push(part);
  }
  const [year = 0, month = 0, day = 0] = parts;
  const date = makeDate(year, month, day);
  return date === null ? formulaError('#NUM!', 'Data inválida') : { kind: 'date', value: date };
});

const FORMAT_DATE = dateFunction((date, values) => {
  if (values.length < 2) return textValue(formatDate(date, 'DD/MM/YYYY'));
  const pattern = toText(arg(values, 1));
  return isError(pattern) ? pattern : textValue(formatDate(date, pattern));
});

// ---------- Textos ----------

function chars(text: string): string[] {
  return Array.from(text);
}

function textFunction(operation: (text: string, values: Value[]) => Value): FormulaFunction {
  return eager((values) => {
    const text = toText(arg(values, 0));
    return isError(text) ? text : operation(text, values);
  });
}

function nonNegative(value: Value, label: string): number | FormulaError {
  const integer = toInteger(value);
  if (isError(integer)) return integer;
  return integer < 0 ? formulaError('#VALUE!', `${label} não pode ser negativo`) : integer;
}

function sliceFunction(fromEnd: boolean): FormulaFunction {
  return textFunction((text, values) => {
    const count = values.length > 1 ? nonNegative(arg(values, 1), 'Quantidade') : 1;
    if (isError(count)) return count;
    const list = chars(text);
    return textValue(
      (fromEnd ? list.slice(Math.max(list.length - count, 0)) : list.slice(0, count)).join(''),
    );
  });
}

/** Posição (base 0) de `find` em `text`, sem diferenciar maiúsculas; -1 se não encontrar. */
function searchIndex(find: string, text: string): number {
  const haystack = chars(text).map((char) => char.toLocaleLowerCase('pt-BR'));
  const needle = chars(find).map((char) => char.toLocaleLowerCase('pt-BR'));
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((char, offset) => haystack[start + offset] === char)) return start;
  }
  return -1;
}

function twoTexts(operation: (first: string, second: string) => Value): FormulaFunction {
  return eager((values) => {
    const first = toText(arg(values, 0));
    if (isError(first)) return first;
    const second = toText(arg(values, 1));
    return isError(second) ? second : operation(first, second);
  });
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Número no formato pt-BR (milhar com ponto, decimais com vírgula). */
function formatNumberBr(number: Dec, decimals: number | null): string {
  const fixed = decimals === null ? number.toFixed() : number.toFixed(decimals);
  const negative = fixed.startsWith('-') && /[1-9]/.test(fixed);
  const [integer = '0', fraction] = fixed.replace('-', '').split('.');
  const body = fraction ? `${groupThousands(integer)},${fraction}` : groupThousands(integer);
  return negative ? `-${body}` : body;
}

const TEXT = eager((values) => {
  const value = unwrap(arg(values, 0));
  let decimals: number | null = null;
  if (values.length > 1) {
    const parsed = nonNegative(arg(values, 1), 'Casas decimais');
    if (isError(parsed)) return parsed;
    if (parsed > MAX_DECIMALS) return formulaError('#VALUE!', 'Casas decimais demais');
    decimals = parsed;
  }
  switch (value.kind) {
    case 'number':
      return textValue(formatNumberBr(new Dec(value.value), decimals));
    case 'date':
    case 'datetime': {
      const date = toDate(value);
      if (isError(date)) return date;
      return textValue(date === null ? '' : formatDate(date, 'DD/MM/YYYY'));
    }
    case 'text': {
      const parsed = parseNumericText(value.value);
      if (parsed) return textValue(formatNumberBr(parsed, decimals));
      return decimals === null
        ? value
        : formulaError('#VALUE!', `Valor "${value.value}" não é um número`);
    }
    default: {
      const text = toText(value);
      return isError(text) ? text : textValue(text);
    }
  }
});

const VALUE = eager((values) => {
  const value = unwrap(arg(values, 0));
  if (value.kind === 'number' || value.kind === 'empty') {
    const number = toNumber(value);
    return isError(number) ? number : numberValue(number);
  }
  if (value.kind === 'text') {
    if (value.value.trim() === '') return numberValue(new Dec(0));
    const parsed = parseNumericText(value.value);
    return parsed
      ? numberValue(parsed)
      : formulaError('#VALUE!', `Valor "${value.value}" não é um número`);
  }
  return formulaError('#VALUE!', 'VALUE espera um texto numérico');
});

const CONCAT = eager((values) => {
  const parts: string[] = [];
  for (const value of values) {
    const text = toText(value);
    if (isError(text)) return text;
    parts.push(text);
  }
  return textValue(parts.join(''));
});

// ---------- Registro ----------

export const FORMULA_FUNCTION_IMPLEMENTATIONS: Readonly<Record<string, FormulaFunction>> = {
  IF,
  IFS,
  SWITCH,
  AND: logical((items) => items.every(Boolean)),
  OR: logical((items) => items.some(Boolean)),
  XOR: logical((items) => items.filter(Boolean).length % 2 === 1),
  NOT: eager((values) => {
    const test = toBoolean(arg(values, 0));
    return isError(test) ? test : booleanValue(!test);
  }),
  IFERROR,
  ISERROR,
  ISBLANK,
  ISNUMBER,

  SUM: aggregate((numbers) => numberValue(sum(numbers))),
  AVERAGE,
  AVG: AVERAGE,
  MIN: extreme(-1),
  MAX: extreme(1),
  COUNT,
  COUNTA,
  ROUND: rounding(Dec.ROUND_HALF_UP),
  ROUNDUP: rounding(Dec.ROUND_UP),
  ROUNDDOWN: rounding(Dec.ROUND_DOWN),
  CEILING: multipleRounding('ceiling'),
  FLOOR: multipleRounding('floor'),
  ABS: unaryMath((number) => numberValue(number.abs())),
  // Excel: o resultado tem o sinal do divisor.
  MOD: binaryMath((number, divisor) =>
    divisor.isZero()
      ? divisionByZero()
      : numberValue(
          number.minus(divisor.times(number.div(divisor).toDecimalPlaces(0, Dec.ROUND_FLOOR))),
        ),
  ),
  POWER: binaryMath(power),
  SQRT: unaryMath((number) =>
    number.isNegative() && !number.isZero()
      ? formulaError('#NUM!', 'Raiz quadrada de número negativo')
      : numberValue(number.sqrt()),
  ),
  INT: unaryMath((number) => numberValue(number.toDecimalPlaces(0, Dec.ROUND_FLOOR))),
  PERCENT: binaryMath((part, total) =>
    total.isZero() ? divisionByZero() : numberValue(part.div(total).times(100)),
  ),

  TODAY: (_args, { context }) =>
    isValidDate(context.today)
      ? { kind: 'date', value: context.today }
      : formulaError('#VALUE!', 'Data de hoje inválida no contexto'),
  NOW: (_args, { context }) =>
    isValidDatetime(context.now)
      ? { kind: 'datetime', value: new Date(context.now).toISOString() }
      : formulaError('#VALUE!', 'Data-hora atual inválida no contexto'),
  DATE,
  YEAR: datePart((date) => dateParts(date).year),
  MONTH: datePart((date) => dateParts(date).month),
  DAY: datePart((date) => dateParts(date).day),
  WEEKDAY: datePart(isoWeekday),
  WEEKNUM: datePart(isoWeekNumber),
  DAYS: twoDates((end, start) => numberValue(new Dec(daysBetween(start, end)))),
  WORKDAYS,
  ADD_DAYS: dateShift((date, amount) => dateValue(addDays(date, amount)), 3_700_000),
  ADD_WORKDAYS,
  EDATE: dateShift((date, months) => dateValue(addMonths(date, months)), 120_000),
  EOMONTH: dateShift((date, months) => dateValue(endOfMonth(date, months)), 120_000),
  FORMAT_DATE,

  CONCAT,
  CONCATENATE: CONCAT,
  LEN: textFunction((text) => numberValue(new Dec(chars(text).length))),
  LEFT: sliceFunction(false),
  RIGHT: sliceFunction(true),
  MID: textFunction((text, values) => {
    const start = toInteger(arg(values, 1));
    if (isError(start)) return start;
    if (start < 1) return formulaError('#VALUE!', 'Início deve ser maior ou igual a 1');
    const count = nonNegative(arg(values, 2), 'Quantidade');
    if (isError(count)) return count;
    return textValue(
      chars(text)
        .slice(start - 1, start - 1 + count)
        .join(''),
    );
  }),
  UPPER: textFunction((text) => textValue(text.toLocaleUpperCase('pt-BR'))),
  LOWER: textFunction((text) => textValue(text.toLocaleLowerCase('pt-BR'))),
  // Como no Excel: remove espaços das pontas e reduz sequências internas a um espaço.
  TRIM: textFunction((text) => textValue(text.replace(/ {2,}/g, ' ').replace(/^ | $/g, ''))),
  SUBSTITUTE: textFunction((text, values) => {
    const search = toText(arg(values, 1));
    if (isError(search)) return search;
    const replacement = toText(arg(values, 2));
    if (isError(replacement)) return replacement;
    return textValue(search === '' ? text : text.replaceAll(search, replacement));
  }),
  REPLACE: textFunction((text, values) => {
    const start = toInteger(arg(values, 1));
    if (isError(start)) return start;
    if (start < 1) return formulaError('#VALUE!', 'Início deve ser maior ou igual a 1');
    const count = nonNegative(arg(values, 2), 'Quantidade');
    if (isError(count)) return count;
    const replacement = toText(arg(values, 3));
    if (isError(replacement)) return replacement;
    const list = chars(text);
    return textValue(
      list.slice(0, start - 1).join('') + replacement + list.slice(start - 1 + count).join(''),
    );
  }),
  SEARCH: twoTexts((find, text) => {
    const index = searchIndex(find, text);
    return index === -1
      ? formulaError('#VALUE!', `Texto "${find}" não encontrado`)
      : numberValue(new Dec(index + 1));
  }),
  CONTAINS: twoTexts((text, find) => booleanValue(searchIndex(find, text) !== -1)),
  TEXT,
  VALUE,
  REPT: textFunction((text, values) => {
    const times = nonNegative(arg(values, 1), 'Repetições');
    if (isError(times)) return times;
    if (text.length * times > MAX_TEXT_LENGTH) {
      return formulaError('#VALUE!', `Texto resultante excede ${MAX_TEXT_LENGTH} caracteres`);
    }
    return textValue(text.repeat(times));
  }),
};

export function findFunctionImplementation(name: string): FormulaFunction | undefined {
  return Object.hasOwn(FORMULA_FUNCTION_IMPLEMENTATIONS, name)
    ? FORMULA_FUNCTION_IMPLEMENTATIONS[name]
    : undefined;
}
