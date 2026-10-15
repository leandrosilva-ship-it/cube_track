import { describe, expect, it } from 'vitest';

import { FormulaSyntaxError } from './ast.js';
import { FORMULA_FUNCTIONS } from './catalog.js';
import { FORMULA_FUNCTION_IMPLEMENTATIONS } from './functions.js';
import { MAX_FORMULA_DEPTH, parseFormula } from './parser.js';
import { MAX_FORMULA_LENGTH, tokenize } from './tokenizer.js';

function syntaxError(expression: string): FormulaSyntaxError {
  try {
    parseFormula(expression);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return error;
    throw error;
  }
  throw new Error(`Esperava erro de sintaxe em ${expression}`);
}

describe('tokenizer', () => {
  it('lê textos com aspas escapadas', () => {
    expect(tokenize('"a ""b"""')[0]).toEqual({ type: 'text', value: 'a "b"', position: 0 });
    expect(tokenize('""')[0]).toEqual({ type: 'text', value: '', position: 0 });
  });

  it('lê números em vários formatos', () => {
    const texts = tokenize('12 3.5 .5 1e3 2E-2').flatMap((token) =>
      token.type === 'number' ? [token.text] : [],
    );
    expect(texts).toEqual(['12', '3.5', '.5', '1e3', '2E-2']);
  });

  it('lê referências com espaços e acentos, sem espaços nas pontas', () => {
    expect(tokenize('{ Término Planejado }')[0]).toEqual({
      type: 'reference',
      name: 'Término Planejado',
      position: 0,
    });
  });

  it('aceita "," e ";" como separadores e ignora "=" inicial', () => {
    const types = tokenize(' =SUM(1;2,3)').map((token) => token.type);
    expect(types).toEqual([
      'identifier',
      'open',
      'number',
      'separator',
      'number',
      'separator',
      'number',
      'close',
      'end',
    ]);
  });

  it('reconhece operadores compostos', () => {
    const operators = tokenize('1<>2<=3>=4<5>6').flatMap((token) =>
      token.type === 'operator' ? [token.operator] : [],
    );
    expect(operators).toEqual(['<>', '<=', '>=', '<', '>']);
  });
});

describe('parser', () => {
  it('normaliza literais numéricos', () => {
    expect(parseFormula('1e3')).toEqual({ type: 'number', value: '1000', position: 0 });
    expect(parseFormula('.5')).toMatchObject({ type: 'number', value: '0.5' });
  });

  it('respeita a precedência do Excel', () => {
    expect(parseFormula('1+2*3')).toMatchObject({
      type: 'binary',
      operator: '+',
      right: { type: 'binary', operator: '*' },
    });
    expect(parseFormula('"a"&1+1')).toMatchObject({
      operator: '&',
      right: { operator: '+' },
    });
    expect(parseFormula('1+1=2')).toMatchObject({ operator: '=', left: { operator: '+' } });
  });

  it('trata ^ como associativo à direita e o sinal unário com precedência maior', () => {
    expect(parseFormula('2^3^2')).toMatchObject({
      operator: '^',
      left: { value: '2' },
      right: { operator: '^' },
    });
    expect(parseFormula('-2^2')).toMatchObject({
      operator: '^',
      left: { type: 'unary', operator: '-' },
    });
  });

  it('lê % pós-fixo, booleanos e funções sem diferenciar maiúsculas', () => {
    expect(parseFormula('10%')).toMatchObject({ type: 'percent', operand: { value: '10' } });
    expect(parseFormula('true')).toEqual({ type: 'boolean', value: true, position: 0 });
    expect(parseFormula('round(1.5; 0)')).toMatchObject({ type: 'call', name: 'ROUND' });
  });

  it('não acusa função desconhecida na análise', () => {
    expect(parseFormula('FOO(1, 2)')).toMatchObject({ type: 'call', name: 'FOO' });
  });

  it('informa a posição de erros de sintaxe', () => {
    expect(syntaxError('(1+2').position).toBe(0);
    expect(syntaxError('(1+2').message).toBe('Parêntese "(" não fechado');
    expect(syntaxError('1+2)').position).toBe(3);
    expect(syntaxError('1 & "abc').position).toBe(4);
    expect(syntaxError('1 & "abc').message).toBe('Texto sem aspas de fechamento');
    expect(syntaxError('{c_a} + { }').position).toBe(8);
    expect(syntaxError('{c_a} + { }').message).toBe('Referência de coluna vazia');
    expect(syntaxError('{c_a').message).toBe('Referência de coluna sem "}" de fechamento');
    expect(syntaxError('1 +').position).toBe(3);
    expect(syntaxError('1 +').message).toBe('Fórmula incompleta: falta um valor');
    expect(syntaxError('').message).toBe('Fórmula vazia');
    expect(syntaxError('SUM(1,,2)').position).toBe(6);
    expect(syntaxError('1 $ 2').position).toBe(2);
    expect(syntaxError('Sim').message).toContain('use aspas');
  });

  it('valida a quantidade de argumentos pelo catálogo', () => {
    const error = syntaxError('1 + ROUND(1, 2, 3)');
    expect(error.position).toBe(4);
    expect(error.message).toBe('A função ROUND espera de 1 a 2 argumentos (recebeu 3)');
    expect(syntaxError('TODAY(1)').message).toBe('A função TODAY espera 0 argumentos (recebeu 1)');
    expect(syntaxError('SUM()').message).toBe(
      'A função SUM espera ao menos 1 argumento (recebeu 0)',
    );
    expect(syntaxError('IFS(TRUE, 1, FALSE)').message).toContain('pares');
  });

  it('limita tamanho e aninhamento', () => {
    expect(() => parseFormula('1'.repeat(MAX_FORMULA_LENGTH))).not.toThrow();
    const long = syntaxError('1'.repeat(MAX_FORMULA_LENGTH + 1));
    expect(long.message).toContain('4000 caracteres');
    const ok = `${'('.repeat(MAX_FORMULA_DEPTH)}1${')'.repeat(MAX_FORMULA_DEPTH)}`;
    expect(() => parseFormula(ok)).not.toThrow();
    const deep = `${'('.repeat(MAX_FORMULA_DEPTH + 1)}1${')'.repeat(MAX_FORMULA_DEPTH + 1)}`;
    expect(syntaxError(deep).position).toBe(MAX_FORMULA_DEPTH);
    expect(syntaxError(`${'-'.repeat(100)}1`).message).toContain('64 níveis');
  });
});

describe('catálogo de funções', () => {
  it('tem implementação para cada função e nomes únicos', () => {
    const names = FORMULA_FUNCTIONS.map((info) => info.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(FORMULA_FUNCTION_IMPLEMENTATIONS[name]).toBeTypeOf('function');
    expect(Object.keys(FORMULA_FUNCTION_IMPLEMENTATIONS).sort()).toEqual([...names].sort());
  });
});
