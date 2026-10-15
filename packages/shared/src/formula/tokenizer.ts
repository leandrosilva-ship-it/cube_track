import { FormulaSyntaxError } from './ast.js';

export type FormulaOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '&'
  | '%'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>=';

export type FormulaToken =
  | { type: 'number'; text: string; position: number }
  | { type: 'text'; value: string; position: number }
  | { type: 'reference'; name: string; position: number }
  | { type: 'identifier'; name: string; position: number }
  | { type: 'operator'; operator: FormulaOperator; position: number }
  | { type: 'open'; position: number }
  | { type: 'close'; position: number }
  | { type: 'separator'; position: number }
  | { type: 'end'; position: number };

export const MAX_FORMULA_LENGTH = 4000;

const NUMBER_PATTERN = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_.]*/y;
const WHITESPACE = /\s/;
const SINGLE_OPERATORS = new Set(['+', '-', '*', '/', '^', '&', '%', '=']);

function readString(expression: string, start: number): { value: string; end: number } {
  let value = '';
  let index = start + 1;
  while (index < expression.length) {
    const char = expression.charAt(index);
    if (char === '"') {
      // `""` dentro do texto representa uma aspa literal.
      if (expression.charAt(index + 1) === '"') {
        value += '"';
        index += 2;
        continue;
      }
      return { value, end: index + 1 };
    }
    value += char;
    index += 1;
  }
  throw new FormulaSyntaxError('Texto sem aspas de fechamento', start);
}

function readReference(expression: string, start: number): { name: string; end: number } {
  const close = expression.indexOf('}', start + 1);
  const nested = expression.indexOf('{', start + 1);
  if (close === -1 || (nested !== -1 && nested < close)) {
    throw new FormulaSyntaxError('Referência de coluna sem "}" de fechamento', start);
  }
  const name = expression.slice(start + 1, close).trim();
  if (name === '') throw new FormulaSyntaxError('Referência de coluna vazia', start);
  return { name, end: close + 1 };
}

/** Quebra a expressão em tokens. Um `=` inicial (estilo planilha) é ignorado. */
export function tokenize(expression: string): FormulaToken[] {
  if (expression.length > MAX_FORMULA_LENGTH) {
    throw new FormulaSyntaxError(
      `Fórmula excede o limite de ${MAX_FORMULA_LENGTH} caracteres`,
      MAX_FORMULA_LENGTH,
    );
  }
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < expression.length && WHITESPACE.test(expression.charAt(index))) index += 1;
  if (expression.charAt(index) === '=') index += 1;

  while (index < expression.length) {
    const char = expression.charAt(index);
    const position = index;
    if (WHITESPACE.test(char)) {
      index += 1;
      continue;
    }
    if (char === '"') {
      const { value, end } = readString(expression, index);
      tokens.push({ type: 'text', value, position });
      index = end;
      continue;
    }
    if (char === '{') {
      const { name, end } = readReference(expression, index);
      tokens.push({ type: 'reference', name, position });
      index = end;
      continue;
    }
    if (char === '}') throw new FormulaSyntaxError('"}" sem "{" correspondente', position);
    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'open' : 'close', position });
      index += 1;
      continue;
    }
    if (char === ',' || char === ';') {
      tokens.push({ type: 'separator', position });
      index += 1;
      continue;
    }
    if (char === '<' || char === '>') {
      const next = expression.charAt(index + 1);
      if (next === '=' || (char === '<' && next === '>')) {
        tokens.push({ type: 'operator', operator: `${char}${next}` as FormulaOperator, position });
        index += 2;
      } else {
        tokens.push({ type: 'operator', operator: char, position });
        index += 1;
      }
      continue;
    }
    if (SINGLE_OPERATORS.has(char)) {
      tokens.push({ type: 'operator', operator: char as FormulaOperator, position });
      index += 1;
      continue;
    }
    NUMBER_PATTERN.lastIndex = index;
    const number = NUMBER_PATTERN.exec(expression);
    if (number) {
      tokens.push({ type: 'number', text: number[0], position });
      index += number[0].length;
      continue;
    }
    IDENTIFIER_PATTERN.lastIndex = index;
    const identifier = IDENTIFIER_PATTERN.exec(expression);
    if (identifier) {
      tokens.push({ type: 'identifier', name: identifier[0], position });
      index += identifier[0].length;
      continue;
    }
    throw new FormulaSyntaxError(`Caractere inesperado "${char}"`, position);
  }
  tokens.push({ type: 'end', position: expression.length });
  return tokens;
}
