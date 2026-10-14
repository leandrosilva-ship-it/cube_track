import { describe, expect, it } from 'vitest';

import { toCsv } from './csv';

const BOM = String.fromCharCode(0xfeff);

describe('toCsv', () => {
  it('pt-BR usa ponto e vírgula, BOM e CRLF', () => {
    expect(toCsv(['Nome', 'Prazo'], [['Item 1', '14/10/2026']], 'pt-BR')).toBe(
      `${BOM}Nome;Prazo\r\nItem 1;14/10/2026\r\n`,
    );
  });

  it('escapa aspas, quebras de linha e o separador (RFC 4180)', () => {
    const csv = toCsv(['a'], [['diz "oi"'], ['linha\nnova'], ['1;2']], 'pt-BR');
    expect(csv).toBe(`${BOM}a\r\n"diz ""oi"""\r\n"linha\nnova"\r\n"1;2"\r\n`);
  });

  it('en usa vírgula (ponto e vírgula não precisa de aspas)', () => {
    expect(toCsv(['a', 'b'], [['1,5', '1;5']], 'en')).toBe(`${BOM}a,b\r\n"1,5",1;5\r\n`);
  });
});
