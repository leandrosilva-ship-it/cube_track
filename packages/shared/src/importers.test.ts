import { describe, expect, it } from 'vitest';

import { suggestImportMapping, trelloExportToTable } from './importers.js';

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
