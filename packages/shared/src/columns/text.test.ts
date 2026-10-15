import { describe, expect, it } from 'vitest';

import { parseCsv, toCsv } from '../csv.js';
import { remapColumnValue, suggestColumnMapping, type MappableColumn } from './mapping.js';
import {
  formatCellText,
  parseCellText,
  parseLocaleDate,
  parseLocaleNumber,
  type CellTextColumn,
  type CellTextDirectory,
} from './text.js';

const directory: CellTextDirectory = {
  people: [
    { id: 'u1', name: 'Ana Paula Ribeiro', email: 'ana.ribeiro@empresademo.com.br' },
    { id: 'u2', name: 'Thiago Pereira', email: 'thiago.pereira@empresademo.com.br' },
  ],
  teams: [{ id: 't1', name: 'PMO' }],
  items: [{ id: 'i1', name: 'Contrato 01/2026' }],
};

const column = (
  type: string,
  settings: Record<string, unknown> = {},
  extra: Partial<CellTextColumn> = {},
): CellTextColumn => ({
  key: `c_${type}`,
  type,
  settings,
  ...extra,
});

describe('números e datas no padrão do idioma', () => {
  it.each([
    ['1.234,56', '1234.56'],
    ['R$ 10,00', '10'],
    ['12,5 UST', '12.5'],
    ['-3', '-3'],
    ['1.234.567', '1234567'],
    ['0,123456', '0.1235'],
    ['abc', null],
  ])('pt-BR %s → %s', (text, expected) => {
    expect(parseLocaleNumber(text)).toBe(expected);
  });

  it('inglês usa vírgula como milhar', () => {
    expect(parseLocaleNumber('1,234.5', 'en')).toBe('1234.5');
    expect(parseLocaleNumber('1,234', 'en')).toBe('1234');
  });

  it('datas dd/mm/aaaa, ISO, ano curto e hora; rejeita datas impossíveis', () => {
    expect(parseLocaleDate('14/10/2026')).toEqual({ d: '2026-10-14' });
    expect(parseLocaleDate('2026-10-14T09:30:00Z')).toEqual({ d: '2026-10-14', time: '09:30' });
    expect(parseLocaleDate('1/2/26')).toEqual({ d: '2026-02-01' });
    expect(parseLocaleDate('10/14/2026', 'en')).toEqual({ d: '2026-10-14' });
    expect(parseLocaleDate('31/02/2026')).toBeNull();
  });
});

describe('parseCellText / formatCellText (ida e volta)', () => {
  const status = column(
    'status',
    {},
    {
      labels: [
        { id: 'l1', label: 'Concluído' },
        { id: 'l2', label: 'Em andamento' },
      ],
    },
  );
  const dropdown = column(
    'dropdown',
    { multiple: true },
    {
      options: [
        { id: 'o1', label: 'SMIT' },
        { id: 'o2', label: 'SEGES' },
      ],
    },
  );
  const ust = column('number', { unit: 'UST', unitPosition: 'suffix', decimals: 2 });

  it('rótulos e opções sem acento/maiúsculas; desconhecidos são relatados', () => {
    expect(parseCellText(status, 'concluido', directory)).toEqual({
      ok: true,
      value: { labelId: 'l1' },
    });
    expect(parseCellText(status, 'Parado', directory)).toEqual({
      ok: false,
      reason: 'unknown_label',
      unknown: ['Parado'],
    });
    expect(parseCellText(dropdown, 'smit; seges', directory)).toEqual({
      ok: true,
      value: { optionIds: ['o1', 'o2'] },
    });
  });

  it('pessoas por nome ou e-mail e times', () => {
    expect(
      parseCellText(column('people'), 'ana.ribeiro@empresademo.com.br, PMO', directory),
    ).toEqual({
      ok: true,
      value: { personIds: ['u1'], teamIds: ['t1'] },
    });
    expect(parseCellText(column('people'), 'Fulano', directory)).toMatchObject({
      ok: false,
      reason: 'unknown_person',
    });
  });

  it('checkbox, timeline, link, rating, relação e vazio', () => {
    expect(parseCellText(column('checkbox'), 'Sim')).toEqual({
      ok: true,
      value: { checked: true },
    });
    expect(parseCellText(column('checkbox'), 'não')).toEqual({ ok: true, value: null });
    expect(parseCellText(column('timeline'), '01/10/2026 - 31/10/2026')).toEqual({
      ok: true,
      value: { from: '2026-10-01', to: '2026-10-31' },
    });
    expect(parseCellText(column('link'), 'Portal (https://sei.sp.gov.br)')).toEqual({
      ok: true,
      value: { url: 'https://sei.sp.gov.br', text: 'Portal' },
    });
    expect(parseCellText(column('rating', { max: 5 }), '★★★')).toEqual({
      ok: true,
      value: { n: '3' },
    });
    expect(parseCellText(column('rating', { max: 5 }), '7')).toMatchObject({ ok: false });
    expect(parseCellText(column('board_relation'), 'contrato 01/2026', directory)).toEqual({
      ok: true,
      value: { itemIds: ['i1'] },
    });
    expect(parseCellText(column('text'), '   ')).toEqual({ ok: true, value: null });
    expect(parseCellText(column('formula'), '1')).toEqual({ ok: false, reason: 'read_only' });
  });

  it('formatação para copiar (sem unidade) e exibir (com unidade)', () => {
    expect(formatCellText(ust, { n: '12.5' })).toBe('12,50');
    expect(formatCellText(ust, { n: '12.5' }, directory, { withUnit: true })).toBe('12,50 UST');
    expect(formatCellText(status, { labelId: 'l2' })).toBe('Em andamento');
    expect(
      formatCellText(column('date', { includeTime: true }), { d: '2026-10-14', time: '09:30' }),
    ).toBe('14/10/2026 09:30');
    expect(
      formatCellText(column('people'), { personIds: ['u2'], teamIds: ['t1'] }, directory),
    ).toBe('Thiago Pereira, PMO');
    expect(
      formatCellText(
        column('formula'),
        { n: '3.5', computedAt: '2026-10-14T00:00:00.000Z' },
        directory,
        { locale: 'en' },
      ),
    ).toBe('3.5');
    const roundTrip = formatCellText(dropdown, { optionIds: ['o2', 'o1'] });
    expect(parseCellText(dropdown, roundTrip)).toEqual({
      ok: true,
      value: { optionIds: ['o2', 'o1'] },
    });
  });
});

describe('CSV', () => {
  it('detecta separador, aspas, quebras de linha e BOM', () => {
    const csv = toCsv(
      ['Nome', 'Obs'],
      [
        ['A; B', 'linha 1\nlinha 2'],
        ['diz "oi"', ''],
      ],
      'pt-BR',
    );
    expect(parseCsv(csv)).toEqual([
      ['Nome', 'Obs'],
      ['A; B', 'linha 1\nlinha 2'],
      ['diz "oi"', ''],
    ]);
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('mapeamento entre boards', () => {
  const mappable = (
    key: string,
    type: string,
    title: string,
    extra: Partial<MappableColumn> = {},
  ): MappableColumn => ({
    key,
    type,
    title,
    binding: null,
    settings: {},
    ...extra,
  });
  const source = [
    mappable('c_status', 'status', 'Status', { labels: [{ id: 's1', label: 'Concluído' }] }),
    mappable('c_ust', 'number', 'UST'),
    mappable('c_total', 'formula', 'Total'),
    mappable('c_obs', 'text', 'Observação'),
  ];
  const target = [
    mappable('c_status', 'status', 'Status', { labels: [{ id: 't1', label: 'concluído' }] }),
    mappable('c_horas', 'number', 'ust'),
    mappable('c_nota', 'long_text', 'Observação'),
    mappable('c_id', 'auto_id', 'ID'),
  ];

  it('sugere por chave, por título com mesmo tipo e por título; ignora calculadas', () => {
    expect(suggestColumnMapping(source, target)).toEqual({
      c_status: 'c_status',
      c_ust: 'c_horas',
      c_obs: 'c_nota',
    });
  });

  it('converte rótulos pelo texto e tipos diferentes pelo texto da célula', () => {
    const [status, , , obs] = source;
    const [targetStatus, , nota, id] = target;
    if (
      status === undefined ||
      obs === undefined ||
      targetStatus === undefined ||
      nota === undefined ||
      id === undefined
    )
      throw new Error('fixture');
    expect(remapColumnValue(status, targetStatus, { labelId: 's1' }, directory)).toEqual({
      labelId: 't1',
    });
    expect(remapColumnValue(obs, nota, { text: 'urgente' }, directory)).toEqual({
      text: 'urgente',
    });
    expect(remapColumnValue(obs, id, { text: 'x' }, directory)).toBeNull();
  });
});
