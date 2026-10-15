import { describe, expect, it } from 'vitest';

import type { FormulaContext } from './context.js';
import { computeFormula } from './evaluator.js';
import { formulaResultToText } from './values.js';
import type { FormulaResult, FormulaValue } from './values.js';

const values: Record<string, FormulaValue> = {
  c_horas: {
    kind: 'list',
    items: [
      { kind: 'number', value: '2' },
      { kind: 'number', value: '3.5' },
      { kind: 'text', value: 'n/d' },
      { kind: 'empty' },
    ],
  },
  c_prazos: {
    kind: 'list',
    items: [
      { kind: 'date', value: '2026-11-10' },
      { kind: 'date', value: '2026-10-20' },
    ],
  },
  c_vazio: { kind: 'empty' },
  c_nome: { kind: 'text', value: '  Ana   Maria  ' },
};

const context: FormulaContext = {
  resolve: (reference) => values[reference],
  today: '2026-10-14',
  now: '2026-10-14T15:30:00Z',
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: new Set(['2026-11-02', '2026-11-15']) },
};

function run(expression: string): FormulaResult {
  return computeFormula(expression, context);
}

function text(expression: string): string {
  return formulaResultToText(run(expression));
}

describe('funções lógicas', () => {
  it('IF com e sem senão', () => {
    expect(text('IF(1 > 0, "sim", "não")')).toBe('sim');
    expect(text('IF(1 < 0; "sim"; "não")')).toBe('não');
    expect(run('IF(FALSE, 1)')).toEqual({ kind: 'boolean', value: false });
    expect(text('IF({c_vazio}, 1, 2)')).toBe('2');
    expect(text('IF(TRUE, 1, 1/0)')).toBe('1');
    expect(text('IF("talvez", 1, 2)')).toBe('#VALUE!');
  });

  it('IFS e SWITCH', () => {
    expect(text('IFS(1 > 2, "a", 2 > 1, "b")')).toBe('b');
    expect(text('IFS(FALSE, 1)')).toBe('#N/A');
    expect(text('SWITCH("b", "a", 1, "B", 2)')).toBe('2');
    expect(text('SWITCH(3, 1, "um", 2, "dois", "outro")')).toBe('outro');
    expect(text('SWITCH(3, 1, "um")')).toBe('#N/A');
  });

  it('AND, OR, NOT e XOR', () => {
    expect(text('AND(TRUE, 1, "TRUE")')).toBe('true');
    expect(text('AND(TRUE, {c_vazio})')).toBe('false');
    expect(text('OR(FALSE, 0, 2)')).toBe('true');
    expect(text('NOT(0)')).toBe('true');
    expect(text('XOR(TRUE, TRUE, TRUE)')).toBe('true');
    expect(text('XOR(TRUE, TRUE)')).toBe('false');
    expect(text('AND(TRUE, 1/0)')).toBe('#DIV/0!');
  });

  it('IFERROR e funções de informação', () => {
    expect(text('IFERROR(1/0, "sem total")')).toBe('sem total');
    expect(text('IFERROR(10/4, 0)')).toBe('2.5');
    expect(text('IFERROR({c_inexistente}, "-")')).toBe('-');
    expect(text('ISERROR(FOO())')).toBe('true');
    expect(text('ISERROR(1)')).toBe('false');
    expect(text('ISBLANK({c_vazio})')).toBe('true');
    expect(text('ISBLANK(""&"")')).toBe('true');
    expect(text('ISBLANK(0)')).toBe('false');
    expect(text('ISNUMBER(1.5)')).toBe('true');
    expect(text('ISNUMBER("1.5")')).toBe('false');
  });
});

describe('funções matemáticas', () => {
  it('agrega números achatando listas', () => {
    expect(text('SUM(1, 2; 3)')).toBe('6');
    expect(text('SUM({c_horas})')).toBe('5.5');
    expect(text('SUM({c_horas}, 10)')).toBe('15.5');
    expect(text('SUM("abc")')).toBe('#VALUE!');
    expect(text('AVERAGE({c_horas})')).toBe('2.75');
    expect(text('AVG(1, 2)')).toBe('1.5');
    expect(text('AVERAGE({c_vazio})')).toBe('#DIV/0!');
    expect(text('MIN(3, -1, 2)')).toBe('-1');
    expect(text('MAX({c_horas})')).toBe('3.5');
    expect(text('MAX({c_vazio})')).toBe('0');
    expect(run('MIN({c_prazos})')).toEqual({ kind: 'date', value: '2026-10-20' });
    expect(text('COUNT({c_horas}, 1/0, "x")')).toBe('2');
    expect(text('COUNTA({c_horas}, {c_vazio})')).toBe('3');
  });

  it('arredonda metade para longe do zero', () => {
    expect(text('ROUND(12.075, 2)')).toBe('12.08');
    expect(text('ROUND(-2.5)')).toBe('-3');
    expect(text('ROUND(1234.5678, -2)')).toBe('1200');
    expect(text('ROUNDUP(1.231, 2)')).toBe('1.24');
    expect(text('ROUNDUP(-1.231, 2)')).toBe('-1.24');
    expect(text('ROUNDDOWN(1.239, 2)')).toBe('1.23');
    expect(text('ROUNDDOWN(-1.239)')).toBe('-1');
  });

  it('CEILING e FLOOR como no Excel', () => {
    expect(text('CEILING(2.1)')).toBe('3');
    expect(text('CEILING(22, 5)')).toBe('25');
    expect(text('CEILING(-2.5)')).toBe('-2');
    expect(text('CEILING(-2.5, -2)')).toBe('-4');
    expect(text('CEILING(2.5, -1)')).toBe('#NUM!');
    expect(text('FLOOR(2.9)')).toBe('2');
    expect(text('FLOOR(-2.5)')).toBe('-3');
    expect(text('FLOOR(-2.5, -2)')).toBe('-2');
    expect(text('FLOOR(1, 0)')).toBe('#DIV/0!');
  });

  it('demais funções numéricas', () => {
    expect(text('ABS(-3.5)')).toBe('3.5');
    expect(text('MOD(10, 3)')).toBe('1');
    expect(text('MOD(-7, 3)')).toBe('2');
    expect(text('MOD(7, -3)')).toBe('-2');
    expect(text('MOD(1, 0)')).toBe('#DIV/0!');
    expect(text('POWER(2, 10)')).toBe('1024');
    expect(text('SQRT(16)')).toBe('4');
    expect(text('SQRT(-1)')).toBe('#NUM!');
    expect(text('INT(-1.5)')).toBe('-2');
    expect(text('INT(1.9)')).toBe('1');
    expect(text('PERCENT(25, 200)')).toBe('12.5');
    expect(text('PERCENT(1, 0)')).toBe('#DIV/0!');
  });
});

describe('funções de data', () => {
  it('TODAY, NOW e DATE', () => {
    expect(run('TODAY()')).toEqual({ kind: 'date', value: '2026-10-14' });
    expect(run('NOW()')).toEqual({ kind: 'datetime', value: '2026-10-14T15:30:00.000Z' });
    expect(run('DATE(2026, 2, 28)')).toEqual({ kind: 'date', value: '2026-02-28' });
    expect(text('DATE(2026, 2, 29)')).toBe('#NUM!');
    expect(text('DATE(2026, 13, 1)')).toBe('#NUM!');
  });

  it('partes da data, semana ISO e dia da semana', () => {
    expect(text('YEAR("2026-10-14")')).toBe('2026');
    expect(text('MONTH("14/10/2026")')).toBe('10');
    expect(text('DAY(TODAY())')).toBe('14');
    expect(text('WEEKDAY(DATE(2026, 10, 12))')).toBe('1');
    expect(text('WEEKDAY(DATE(2026, 10, 18))')).toBe('7');
    expect(text('WEEKNUM(DATE(2026, 1, 1))')).toBe('1');
    expect(text('WEEKNUM(DATE(2027, 1, 1))')).toBe('53');
    expect(text('WEEKNUM(DATE(2024, 12, 30))')).toBe('1');
    expect(run('YEAR({c_vazio})')).toEqual({ kind: 'empty' });
    expect(text('YEAR("ontem")')).toBe('#VALUE!');
  });

  it('DAYS e WORKDAYS com feriados e fins de semana', () => {
    expect(text('DAYS("2026-11-06", "2026-10-26")')).toBe('11');
    // 26/10 a 06/11: 10 dias de semana, menos o feriado de 02/11 (15/11 cai no domingo).
    expect(text('WORKDAYS("2026-10-26", "2026-11-06")')).toBe('9');
    expect(text('WORKDAYS("2026-11-06", "2026-10-26")')).toBe('-9');
    expect(text('WORKDAYS("2026-10-31", "2026-11-01")')).toBe('0');
    expect(text('WORKDAYS("2026-10-30", "2026-10-30")')).toBe('1');
    expect(text('WORKDAYS("2000-01-01", "2200-01-01")')).toBe('#NUM!');
  });

  it('ADD_DAYS, ADD_WORKDAYS, EDATE e EOMONTH', () => {
    expect(run('ADD_DAYS("2026-12-30", 3)')).toEqual({ kind: 'date', value: '2027-01-02' });
    expect(run('ADD_WORKDAYS("2026-10-30", 1)')).toEqual({ kind: 'date', value: '2026-11-03' });
    expect(run('ADD_WORKDAYS("2026-11-03", -1)')).toEqual({ kind: 'date', value: '2026-10-30' });
    expect(run('EDATE("2026-01-31", 1)')).toEqual({ kind: 'date', value: '2026-02-28' });
    expect(run('EDATE("2024-01-31", 1)')).toEqual({ kind: 'date', value: '2024-02-29' });
    expect(run('EDATE("2026-03-15", -3)')).toEqual({ kind: 'date', value: '2025-12-15' });
    expect(run('EOMONTH("2026-01-15", 1)')).toEqual({ kind: 'date', value: '2026-02-28' });
    expect(run('EOMONTH("2026-01-15", 0)')).toEqual({ kind: 'date', value: '2026-01-31' });
    expect(text('ADD_DAYS("9999-12-31", 1)')).toBe('#NUM!');
  });

  it('FORMAT_DATE com tokens', () => {
    expect(text('FORMAT_DATE("2026-03-05")')).toBe('05/03/2026');
    expect(text('FORMAT_DATE("2026-03-05", "D/M/YY")')).toBe('5/3/26');
    expect(text('FORMAT_DATE("2026-03-05", "YYYY-MM-DD")')).toBe('2026-03-05');
  });
});

describe('funções de texto', () => {
  it('concatena e mede', () => {
    expect(text('CONCAT("a", 1, TRUE)')).toBe('a1TRUE');
    expect(text('CONCATENATE("x"; "-"; 2.50)')).toBe('x-2.5');
    expect(text('LEN("ação")')).toBe('4');
    expect(text('LEFT("Projeto")')).toBe('P');
    expect(text('LEFT("Projeto", 3)')).toBe('Pro');
    expect(text('RIGHT("Projeto", 4)')).toBe('jeto');
    expect(text('LEFT("abc", -1)')).toBe('#VALUE!');
    expect(text('MID("Projeto", 2, 3)')).toBe('roj');
    expect(text('MID("abc", 0, 1)')).toBe('#VALUE!');
  });

  it('transforma textos', () => {
    expect(text('UPPER("ação")')).toBe('AÇÃO');
    expect(text('LOWER("ÉPICO")')).toBe('épico');
    expect(text('TRIM({c_nome})')).toBe('Ana Maria');
    expect(text('SUBSTITUTE("a-b-c", "-", "/")')).toBe('a/b/c');
    expect(text('REPLACE("abcdef", 2, 3, "X")')).toBe('aXef');
    expect(text('REPT("ab", 3)')).toBe('ababab');
    expect(text('REPT("a", 40000)')).toBe('#VALUE!');
  });

  it('busca sem diferenciar maiúsculas', () => {
    expect(text('SEARCH("JETO", "Projeto")')).toBe('4');
    expect(text('SEARCH("z", "Projeto")')).toBe('#VALUE!');
    expect(text('CONTAINS("Contrato UST", "ust")')).toBe('true');
    expect(text('CONTAINS("Contrato", "os")')).toBe('false');
  });

  it('TEXT e VALUE no formato pt-BR', () => {
    expect(text('TEXT(1234.5, 2)')).toBe('1.234,50');
    expect(text('TEXT(1234567.891)')).toBe('1.234.567,891');
    expect(text('TEXT(-1234.5, 0)')).toBe('-1.235');
    expect(text('TEXT(DATE(2026, 3, 5))')).toBe('05/03/2026');
    expect(text('TEXT("12,5", 1)')).toBe('12,5');
    expect(text('VALUE("1.234,5")')).toBe('1234.5');
    expect(text('VALUE("1234.5")')).toBe('1234.5');
    expect(text('VALUE("12,5")')).toBe('12.5');
    expect(text('VALUE("doze")')).toBe('#VALUE!');
  });
});
