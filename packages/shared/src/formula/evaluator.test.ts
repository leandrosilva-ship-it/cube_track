import { describe, expect, it } from 'vitest';

import type { FormulaContext } from './context.js';
import { computeFormula, evaluateFormula } from './evaluator.js';
import { parseFormula } from './parser.js';
import { formulaResultToText } from './values.js';
import type { FormulaResult, FormulaValue } from './values.js';

const values: Record<string, FormulaValue> = {
  c_os_emitida: { kind: 'text', value: 'Sim' },
  c_ust: { kind: 'number', value: '10.5' },
  c_texto_num: { kind: 'text', value: '12,5' },
  c_vazio: { kind: 'empty' },
  c_inicio: { kind: 'date', value: '2026-10-01' },
  c_fim: { kind: 'date', value: '2026-10-31' },
  c_tags: {
    kind: 'list',
    items: [
      { kind: 'text', value: 'Urgente' },
      { kind: 'text', value: 'Cliente' },
    ],
  },
  c_um: { kind: 'list', items: [{ kind: 'number', value: '7' }] },
};

const context: FormulaContext = {
  resolve: (reference) => values[reference],
  today: '2026-10-14',
  now: '2026-10-14T15:30:00Z',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: new Set() },
};

function run(expression: string): FormulaResult {
  return computeFormula(expression, context);
}

function text(expression: string): string {
  return formulaResultToText(run(expression));
}

describe('operadores e precedência', () => {
  it('calcula com a precedência do Excel', () => {
    expect(text('1+2*3')).toBe('7');
    expect(text('(1+2)*3')).toBe('9');
    expect(text('2^3^2')).toBe('512');
    expect(text('-2^2')).toBe('4');
    expect(text('10%')).toBe('0.1');
    expect(text('50% * 200')).toBe('100');
    expect(text('"a"&1+1')).toBe('a2');
    expect(text('=  1 + 1')).toBe('2');
    expect(text('2^-1')).toBe('0.5');
  });

  it('usa aritmética decimal exata', () => {
    expect(run('0.1+0.2')).toEqual({ kind: 'number', value: '0.3' });
    // 1/3 é truncado em 40 dígitos; o resultado final é arredondado a 30 dígitos significativos.
    expect(run('1/3*3')).toEqual({ kind: 'number', value: '1' });
    expect(text('1/3')).toBe('0.333333333333333333333333333333');
    expect(text('0.1*3 = 0.3')).toBe('true');
    expect(text('1.10 + 2.20')).toBe('3.3');
  });

  it('converte textos, vazios e booleanos em números', () => {
    expect(text('{c_texto_num} * 2')).toBe('25');
    expect(text('"1.234,5" + 0.5')).toBe('1235');
    expect(text('{c_vazio} + 1')).toBe('1');
    expect(text('TRUE + TRUE')).toBe('2');
    expect(run('"abc" * 2')).toMatchObject({ kind: 'error', code: '#VALUE!' });
  });

  it('compara textos sem diferenciar maiúsculas', () => {
    expect(text('"ABC" = "abc"')).toBe('true');
    expect(text('"a" < "b"')).toBe('true');
    expect(text('"é" = "e"')).toBe('false');
    expect(text('{c_vazio} = ""')).toBe('true');
    expect(text('{c_vazio} = 0')).toBe('true');
    expect(text('1 <> 2')).toBe('true');
    expect(text('{c_texto_num} = 12.5')).toBe('true');
  });

  it('propaga erros e reporta divisão por zero', () => {
    expect(run('1/0')).toEqual({ kind: 'error', code: '#DIV/0!', message: 'Divisão por zero' });
    expect(text('(1/0) + 1')).toBe('#DIV/0!');
    expect(text('"x" & (1/0)')).toBe('#DIV/0!');
    expect(text('ROUND(1/0, 2)')).toBe('#DIV/0!');
    expect(text('0^0')).toBe('#NUM!');
    expect(text('(-8)^0.5')).toBe('#NUM!');
    expect(text('10^200')).toBe('#NUM!');
  });

  it('reporta referência e função desconhecidas', () => {
    expect(run('{c_nao_existe} + 1')).toMatchObject({ kind: 'error', code: '#REF!' });
    expect(run('FOO(1)')).toEqual({
      kind: 'error',
      code: '#NAME?',
      message: 'Função desconhecida: FOO',
    });
  });

  it('transforma erro de sintaxe em #ERROR!', () => {
    expect(run('(1')).toEqual({
      kind: 'error',
      code: '#ERROR!',
      message: 'Parêntese "(" não fechado',
    });
  });
});

describe('datas', () => {
  it('subtrai datas e soma dias', () => {
    expect(run('{c_fim} - {c_inicio}')).toEqual({ kind: 'number', value: '30' });
    expect(run('{c_inicio} + 10')).toEqual({ kind: 'date', value: '2026-10-11' });
    expect(run('5 + {c_inicio}')).toEqual({ kind: 'date', value: '2026-10-06' });
    expect(run('{c_inicio} - 1')).toEqual({ kind: 'date', value: '2026-09-30' });
    expect(text('{c_inicio} + {c_fim}')).toBe('#VALUE!');
    expect(run('{c_inicio} - {c_vazio}')).toEqual({ kind: 'empty' });
  });

  it('compara datas entre si e com textos ISO', () => {
    expect(text('{c_fim} > {c_inicio}')).toBe('true');
    expect(text('{c_inicio} = "2026-10-01"')).toBe('true');
    expect(text('TODAY() < "2026-12-31"')).toBe('true');
    expect(text('{c_vazio} < TODAY()')).toBe('true');
  });

  it('opera data-hora', () => {
    expect(run('NOW() + 0.5')).toEqual({ kind: 'datetime', value: '2026-10-15T03:30:00.000Z' });
    expect(text('NOW() - DATE(2026, 10, 14)')).toBe('0.645833333333333333333333333333');
  });
});

describe('listas', () => {
  it('une listas em texto e agrega números', () => {
    expect(run('{c_tags}')).toEqual({ kind: 'text', value: 'Urgente, Cliente' });
    expect(text('"Tags: " & {c_tags}')).toBe('Tags: Urgente, Cliente');
    expect(text('{c_um} * 2')).toBe('14');
    expect(text('{c_tags} + 1')).toBe('#VALUE!');
    expect(text('COUNTA({c_tags})')).toBe('2');
  });
});

describe('exemplo UST', () => {
  it('aplica acréscimo de 15% quando a OS foi emitida', () => {
    const ast = parseFormula('IF({c_os_emitida}="Sim", ROUND({c_ust} * 1.15, 2), 0)');
    expect(evaluateFormula(ast, context)).toEqual({ kind: 'number', value: '12.08' });
    const notIssued: FormulaContext = {
      ...context,
      resolve: (reference) =>
        reference === 'c_os_emitida' ? { kind: 'text', value: 'Não' } : values[reference],
    };
    expect(evaluateFormula(ast, notIssued)).toEqual({ kind: 'number', value: '0' });
  });
});

describe('formulaResultToText', () => {
  it('produz a representação de armazenamento', () => {
    expect(formulaResultToText({ kind: 'number', value: '12.500' })).toBe('12.5');
    expect(formulaResultToText({ kind: 'number', value: '-0' })).toBe('0');
    expect(formulaResultToText({ kind: 'boolean', value: true })).toBe('true');
    expect(formulaResultToText({ kind: 'boolean', value: false })).toBe('false');
    expect(formulaResultToText({ kind: 'date', value: '2026-10-14' })).toBe('2026-10-14');
    expect(formulaResultToText({ kind: 'empty' })).toBe('');
    expect(formulaResultToText({ kind: 'error', code: '#N/A', message: 'x' })).toBe('#N/A');
  });
});
