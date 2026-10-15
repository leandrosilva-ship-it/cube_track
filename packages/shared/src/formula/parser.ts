import { FormulaSyntaxError } from './ast.js';
import type { FormulaAst, FormulaBinaryOperator } from './ast.js';
import { findFormulaFunction, PAIRED_ARGUMENT_FUNCTIONS } from './catalog.js';
import { tokenize } from './tokenizer.js';
import type { FormulaOperator, FormulaToken } from './tokenizer.js';
import { parseDecimal } from './values.js';

export const MAX_FORMULA_DEPTH = 64;

const COMPARISON: ReadonlySet<FormulaOperator> = new Set(['=', '<>', '<', '>', '<=', '>=']);
const ADDITIVE: ReadonlySet<FormulaOperator> = new Set(['+', '-']);
const MULTIPLICATIVE: ReadonlySet<FormulaOperator> = new Set(['*', '/']);
const CONCAT: ReadonlySet<FormulaOperator> = new Set(['&']);

function describeToken(token: FormulaToken): string {
  switch (token.type) {
    case 'number':
      return `número ${token.text}`;
    case 'text':
      return 'texto';
    case 'reference':
      return `referência {${token.name}}`;
    case 'identifier':
      return `"${token.name}"`;
    case 'operator':
      return `operador "${token.operator}"`;
    case 'open':
      return '"("';
    case 'close':
      return '")"';
    case 'separator':
      return 'separador de argumentos';
    case 'end':
      return 'fim da fórmula';
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Parser descendente recursivo com a precedência do Excel (da menor para a maior): comparação,
 * `&`, `+ -`, `* /`, `^` (associativo à direita), sinal unário e `%` pós-fixo.
 */
class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly FormulaToken[]) {}

  parse(): FormulaAst {
    if (this.peek().type === 'end') throw new FormulaSyntaxError('Fórmula vazia', 0);
    const ast = this.expression();
    const next = this.peek();
    if (next.type === 'close')
      throw new FormulaSyntaxError('")" sem "(" correspondente', next.position);
    if (next.type !== 'end') this.unexpected(next);
    return ast;
  }

  private peek(): FormulaToken {
    const token = this.tokens[this.index];
    if (!token) throw new FormulaSyntaxError('Fim inesperado da fórmula', 0);
    return token;
  }

  private advance(): FormulaToken {
    const token = this.peek();
    if (token.type !== 'end') this.index += 1;
    return token;
  }

  private unexpected(token: FormulaToken): never {
    if (token.type === 'end') {
      throw new FormulaSyntaxError('Fórmula incompleta: falta um valor', token.position);
    }
    throw new FormulaSyntaxError(`${describeToken(token)} inesperado`, token.position);
  }

  private nested<T>(position: number, parse: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_FORMULA_DEPTH) {
      throw new FormulaSyntaxError(
        `Fórmula excede o limite de ${MAX_FORMULA_DEPTH} níveis de aninhamento`,
        position,
      );
    }
    try {
      return parse();
    } finally {
      this.depth -= 1;
    }
  }

  private matchOperator(operators: ReadonlySet<FormulaOperator>): {
    operator: FormulaOperator;
    position: number;
  } | null {
    const token = this.peek();
    if (token.type === 'operator' && operators.has(token.operator)) {
      this.advance();
      return { operator: token.operator, position: token.position };
    }
    return null;
  }

  private binaryLevel(operators: ReadonlySet<FormulaOperator>, next: () => FormulaAst): FormulaAst {
    let left = next();
    for (let match = this.matchOperator(operators); match; match = this.matchOperator(operators)) {
      const right = next();
      left = {
        type: 'binary',
        operator: match.operator as FormulaBinaryOperator,
        left,
        right,
        position: match.position,
      };
    }
    return left;
  }

  private expression(): FormulaAst {
    return this.binaryLevel(COMPARISON, () => this.concatenation());
  }

  private concatenation(): FormulaAst {
    return this.binaryLevel(CONCAT, () => this.additive());
  }

  private additive(): FormulaAst {
    return this.binaryLevel(ADDITIVE, () => this.multiplicative());
  }

  private multiplicative(): FormulaAst {
    return this.binaryLevel(MULTIPLICATIVE, () => this.exponent());
  }

  private exponent(): FormulaAst {
    const left = this.unary();
    const token = this.peek();
    if (token.type !== 'operator' || token.operator !== '^') return left;
    this.advance();
    const right = this.nested(token.position, () => this.exponent());
    return { type: 'binary', operator: '^', left, right, position: token.position };
  }

  private unary(): FormulaAst {
    const token = this.peek();
    if (token.type === 'operator' && (token.operator === '-' || token.operator === '+')) {
      this.advance();
      const operand = this.nested(token.position, () => this.unary());
      return { type: 'unary', operator: token.operator, operand, position: token.position };
    }
    return this.postfix();
  }

  private postfix(): FormulaAst {
    let operand = this.primary();
    for (let token = this.peek(); token.type === 'operator' && token.operator === '%'; ) {
      this.advance();
      operand = { type: 'percent', operand, position: token.position };
      token = this.peek();
    }
    return operand;
  }

  private primary(): FormulaAst {
    const token = this.advance();
    switch (token.type) {
      case 'number': {
        const value = parseDecimal(token.text);
        if (value === null) {
          throw new FormulaSyntaxError(`Número inválido ${token.text}`, token.position);
        }
        return { type: 'number', value: value.toString(), position: token.position };
      }
      case 'text':
        return { type: 'text', value: token.value, position: token.position };
      case 'reference':
        return { type: 'reference', name: token.name, position: token.position };
      case 'open': {
        const inner = this.nested(token.position, () => this.expression());
        this.expectClose(token.position);
        return inner;
      }
      case 'identifier':
        return this.identifier(token.name, token.position);
      default:
        return this.unexpected(token);
    }
  }

  private identifier(rawName: string, position: number): FormulaAst {
    const name = rawName.toUpperCase();
    if (this.peek().type !== 'open') {
      if (name === 'TRUE' || name === 'FALSE') {
        return { type: 'boolean', value: name === 'TRUE', position };
      }
      throw new FormulaSyntaxError(
        `Nome "${rawName}" desconhecido: use aspas para texto ou {coluna} para referências`,
        position,
      );
    }
    const open = this.advance();
    const args = this.nested(open.position, () => this.arguments());
    this.expectClose(open.position);
    this.checkArity(name, args.length, position);
    return { type: 'call', name, args, position };
  }

  private arguments(): FormulaAst[] {
    const args: FormulaAst[] = [];
    if (this.peek().type === 'close') return args;
    for (;;) {
      const token = this.peek();
      if (token.type === 'separator' || token.type === 'close') {
        throw new FormulaSyntaxError('Argumento vazio', token.position);
      }
      args.push(this.expression());
      if (this.peek().type !== 'separator') return args;
      this.advance();
    }
  }

  private expectClose(openPosition: number): void {
    const token = this.peek();
    if (token.type === 'close') {
      this.advance();
      return;
    }
    if (token.type === 'end')
      throw new FormulaSyntaxError('Parêntese "(" não fechado', openPosition);
    this.unexpected(token);
  }

  private checkArity(name: string, count: number, position: number): void {
    const info = findFormulaFunction(name);
    if (!info) return;
    const { minArgs, maxArgs } = info;
    if (count < minArgs || (maxArgs !== null && count > maxArgs)) {
      const expected =
        maxArgs === null
          ? `ao menos ${plural(minArgs, 'argumento')}`
          : minArgs === maxArgs
            ? plural(minArgs, 'argumento')
            : `de ${minArgs} a ${plural(maxArgs, 'argumento')}`;
      throw new FormulaSyntaxError(
        `A função ${name} espera ${expected} (recebeu ${count})`,
        position,
      );
    }
    if (PAIRED_ARGUMENT_FUNCTIONS.has(name) && count % 2 !== 0) {
      throw new FormulaSyntaxError(
        `A função ${name} espera pares de condição e valor (recebeu ${plural(count, 'argumento')})`,
        position,
      );
    }
  }
}

/** Analisa a expressão (até 4000 caracteres e 64 níveis de aninhamento). */
export function parseFormula(expression: string): FormulaAst {
  return new Parser(tokenize(expression)).parse();
}
