import { describe, expect, it } from 'vitest';

import { inferColumnType, mondaySheetToTable, suggestImportMapping, trelloExportToTable } from './importers.js';

describe('trelloExportToTable', () => {
  const trelloExport = {
    lists: [
      { id: 'l1', name: 'A fazer' },
      { id: 'l2', name: 'Feito' },
    ],
    members: [{ id: 'm1', fullName: 'Ana Ribeiro' }],
    cards: [
      { idList: 'l1', name: 'Revisar contrato', desc: 'Checar cláusulas', due: '2026-12-01T00:00:00.000Z', idMembers: ['m1'], labels: [{ name: 'Urgente' }], closed: false },
      { idList: 'l2', name: 'Cartão arquivado', closed: true },
      { idList: 'l2', name: '' },
    ],
  };

  it('converte listas em grupo e cartões em linhas, ignorando arquivados e sem nome', () => {
    const table = trelloExportToTable(trelloExport);
    expect(table.headers).toEqual(['Group', 'Name', 'Description', 'Due', 'Members', 'Labels']);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toEqual(['A fazer', 'Revisar contrato', 'Checar cláusulas', '2026-12-01', 'Ana Ribeiro', 'Urgente']);
  });

  it('rejeita um JSON que não tenha o formato de export do Trello', () => {
    expect(() => trelloExportToTable({ foo: 'bar' })).toThrow();
    expect(() => trelloExportToTable(null)).toThrow();
  });
});

describe('suggestImportMapping', () => {
  const boardColumns = [{ key: 'c_status', title: 'Status' }, { key: 'c_owner', title: 'Responsável' }];

  it('reconhece "Group" do Monday e casa cabeçalhos pelo título da coluna', () => {
    const mapping = suggestImportMapping('monday', ['Name', 'Group', 'Status'], boardColumns);
    expect(mapping[0]).toEqual({ type: 'name' });
    expect(mapping[1]).toEqual({ type: 'group' });
    expect(mapping[2]).toEqual({ type: 'column', key: 'c_status' });
  });

  it('cabeçalho sem correspondência vira "ignore"', () => {
    const mapping = suggestImportMapping('jira', ['Qualquer coisa'], boardColumns);
    expect(mapping[0]).toEqual({ type: 'ignore' });
  });
});

describe('mondaySheetToTable', () => {
  it('é um passthrough para planilhas comuns (sem linha-marcador antes do cabeçalho)', () => {
    const table = mondaySheetToTable([
      ['Item', 'Grupo', 'Status'],
      ['Novo item', '(Concluído) FATURADO', ''],
    ]);
    expect(table).toEqual({
      headers: ['Item', 'Grupo', 'Status'],
      rows: [['Novo item', '(Concluído) FATURADO', '']],
    });
  });

  it('extrai título, grupos e dados do export "tudo numa aba só" do Monday, descartando o resumo final', () => {
    const table = mondaySheetToTable([
      ['PMSP', '', '', ''],
      ['DEMANDAS EM ANÁLISE', '', '', ''],
      ['Nome', 'Órgão', 'Frente de Trabalho', 'Qtde de UST'],
      ['Tarefa 1', 'SMIT', 'Portal', '16'],
      ['Tarefa 2', 'SMIT', 'Portal', '12'],
      ['(Concluído) FATURADO', '', '', ''],
      ['Tarefa 3', 'SMTE', 'Integração', '4'],
      ['', '', '', ''],
      // Resumo final (ex.: total de UST por contrato): repete um prefixo do cabeçalho e some o resto.
      ['CONTRATO', '', '', ''],
      ['Nome', 'Órgão', 'Frente de Trabalho', ''],
      ['QUANTIDADE DE UST DE CONTRATO', '', '', ''],
      ['QUANTIDADE DE UST DE CONTRATO', '', '', ''],
    ]);
    expect(table.headers).toEqual(['Grupo', 'Nome', 'Órgão', 'Frente de Trabalho', 'Qtde de UST']);
    expect(table.rows).toEqual([
      ['DEMANDAS EM ANÁLISE', 'Tarefa 1', 'SMIT', 'Portal', '16'],
      ['DEMANDAS EM ANÁLISE', 'Tarefa 2', 'SMIT', 'Portal', '12'],
      ['(Concluído) FATURADO', 'Tarefa 3', 'SMTE', 'Integração', '4'],
    ]);
  });

  it('sem linha-marcador alguma, devolve tabela vazia para entrada vazia', () => {
    expect(mondaySheetToTable([])).toEqual({ headers: [], rows: [] });
  });
});

describe('inferColumnType', () => {
  it('reconhece datas (ISO e dd/mm/aaaa)', () => {
    expect(inferColumnType(['2026-11-11', '2026-12-14'])).toBe('date');
    expect(inferColumnType(['11/11/2026', '14/12/2026'])).toBe('date');
  });

  it('reconhece números (inteiros e com vírgula/ponto decimal)', () => {
    expect(inferColumnType(['16', '12', '4'])).toBe('number');
    expect(inferColumnType(['12,5', '3', '1.505,00'])).toBe('number');
  });

  it('reconhece categorias repetidas como "status"', () => {
    expect(inferColumnType(['Melhoria', 'Melhoria', 'Correção', 'Melhoria', 'Correção', 'Nova demanda'])).toBe(
      'status',
    );
  });

  it('usa texto longo quando algum valor passa de 80 caracteres, senão texto', () => {
    expect(inferColumnType(['ok', 'sem nome'])).toBe('text');
    expect(inferColumnType(['x'.repeat(90)])).toBe('long_text');
  });

  it('sem valores preenchidos, usa texto como padrão seguro', () => {
    expect(inferColumnType(['', '  '])).toBe('text');
  });
});
