import { describe, expect, it } from 'vitest';

import { parseFormula } from './parser.js';
import {
  displayFormula,
  formulaReferences,
  isVolatileFormula,
  normalizeFormulaReferences,
} from './references.js';

const columns = [
  { key: 'c_termino', title: 'término planejado' },
  { key: 'c_ust', title: 'UST' },
  { key: 'c_status', title: 'Status' },
];

describe('referências', () => {
  it('lista referências distintas na ordem da primeira ocorrência', () => {
    const ast = parseFormula('IF({c_b} > 0, {c_a} + {c_b}, { c_c })');
    expect(formulaReferences(ast)).toEqual(['c_b', 'c_a', 'c_c']);
    expect(formulaReferences(parseFormula('1 + 2'))).toEqual([]);
  });

  it('identifica fórmulas voláteis', () => {
    expect(isVolatileFormula(parseFormula('DAYS({c_fim}, TODAY())'))).toBe(true);
    expect(isVolatileFormula(parseFormula('IF(TRUE, now(), 1)'))).toBe(true);
    expect(isVolatileFormula(parseFormula('DAYS({c_fim}, {c_inicio})'))).toBe(false);
  });

  it('converte títulos em chaves sem diferenciar maiúsculas e acentos', () => {
    expect(normalizeFormulaReferences('{Término Planejado} + {ust}', columns)).toBe(
      '{c_termino} + {c_ust}',
    );
    expect(normalizeFormulaReferences('{  TERMINO   planejado }', columns)).toBe('{c_termino}');
  });

  it('mantém chaves, nomes desconhecidos e chaves dentro de textos', () => {
    expect(normalizeFormulaReferences('{c_ust} & {Inexistente}', columns)).toBe(
      '{c_ust} & {Inexistente}',
    );
    expect(normalizeFormulaReferences('"{Status}" & {Status}', columns)).toBe(
      '"{Status}" & {c_status}',
    );
    expect(normalizeFormulaReferences('"a ""{UST}""" & {UST}', columns)).toBe(
      '"a ""{UST}""" & {c_ust}',
    );
  });

  it('exibe títulos e faz o caminho de volta', () => {
    const stored = 'IF({c_status} = "Feito", {c_ust} * 2, {c_outro})';
    const shown = displayFormula(stored, columns);
    expect(shown).toBe('IF({Status} = "Feito", {UST} * 2, {c_outro})');
    expect(normalizeFormulaReferences(shown, columns)).toBe(stored);
  });

  it('mantém a chave quando o título tem chaves', () => {
    expect(displayFormula('{c_x}', [{ key: 'c_x', title: 'a {b}' }])).toBe('{c_x}');
  });
});
