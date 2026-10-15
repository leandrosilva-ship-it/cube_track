import { describe, expect, it } from 'vitest';

import type { FilterGroup } from '../query.js';
import {
  matchesFilter,
  resolveDateToken,
  type EvaluableColumn,
  type ItemState,
} from './conditions.js';
import {
  missingRequiredColumns,
  isEmptyColumnValue,
  type RequirementColumn,
} from './requirements.js';

const SIM = '01a13ae4-0000-7000-8000-000000000001';
const NAO = '01a13ae4-0000-7000-8000-000000000002';
const ME = '01a13ae4-0000-7000-8000-0000000000aa';
const TEAM = '01a13ae4-0000-7000-8000-0000000000bb';

const columns: EvaluableColumn[] = [
  { key: 'c_os_emitida', type: 'status', binding: null },
  { key: 'c_sei', type: 'text', binding: null },
  { key: 'c_ust', type: 'number', binding: null },
  { key: 'c_prazo', type: 'date', binding: null },
  { key: 'c_resp', type: 'people', binding: null },
  { key: 'c_ok', type: 'checkbox', binding: null },
  { key: 'c_fim', type: 'date', binding: 'item.planned_end_date' },
];

function state(values: Record<string, unknown>, extra: Partial<ItemState> = {}): ItemState {
  return { name: 'Demanda 1', groupId: 'g1', values, fields: {}, completed: false, ...extra };
}

const context = { currentUserId: ME, currentUserTeamIds: [TEAM], today: '2026-10-14' };
const filter = (conditions: FilterGroup['conditions'], op: 'and' | 'or' = 'and'): FilterGroup => ({
  op,
  conditions,
});

describe('resolveDateToken', () => {
  it('resolve semana (segunda a domingo), mês e janelas relativas', () => {
    expect(resolveDateToken('this_week', '2026-10-14')).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
    expect(resolveDateToken('next_week', '2026-10-18')).toEqual({
      from: '2026-10-19',
      to: '2026-10-25',
    });
    expect(resolveDateToken('this_month', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(resolveDateToken('last_month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(resolveDateToken('next_7_days', '2026-10-14')).toEqual({
      from: '2026-10-14',
      to: '2026-10-20',
    });
  });
});

describe('matchesFilter', () => {
  it('status, texto e números (decimal) com E/OU aninhados', () => {
    const item = state({
      c_os_emitida: { labelId: SIM },
      c_sei: { text: 'SEI 6011.2026/0001' },
      c_ust: { n: '10.5' },
    });
    expect(
      matchesFilter(
        filter([
          { field: 'c_os_emitida', operator: 'is', value: SIM },
          filter(
            [
              { field: 'c_ust', operator: 'gt', value: '100' },
              { field: 'c_sei', operator: 'contains', value: 'sei 6011' },
            ],
            'or',
          ),
        ]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'c_ust', operator: 'between', value: ['10.5', '11'] }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'c_os_emitida', operator: 'none_of', value: [SIM, NAO] }]),
        item,
        columns,
        context,
      ),
    ).toBe(false);
  });

  it('vazios, checkbox e pessoas com "eu" (inclui times do usuário)', () => {
    const item = state({ c_resp: { personIds: [], teamIds: [TEAM] }, c_ok: { checked: true } });
    expect(
      matchesFilter(
        filter([{ field: 'c_resp', operator: 'any_of', value: ['me'] }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(filter([{ field: 'c_sei', operator: 'is_empty' }]), item, columns, context),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'c_ok', operator: 'is', value: true }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(filter([{ field: 'c_ok', operator: 'is_empty' }]), item, columns, context),
    ).toBe(false);
  });

  it('datas com períodos dinâmicos, "atrasados" e colunas vinculadas a campos nativos', () => {
    const item = state(
      { c_prazo: { d: '2026-10-10' } },
      { fields: { planned_end_date: '2026-10-16' } },
    );
    expect(
      matchesFilter(filter([{ field: 'c_prazo', operator: 'overdue' }]), item, columns, context),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'c_prazo', operator: 'overdue' }]),
        { ...item, completed: true },
        columns,
        context,
      ),
    ).toBe(false);
    expect(
      matchesFilter(
        filter([{ field: 'c_fim', operator: 'is', value: 'this_week' }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'c_prazo', operator: 'before', value: 'today' }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'planned_end_date', operator: 'after', value: '2026-10-15' }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
    expect(
      matchesFilter(
        filter([{ field: 'name', operator: 'contains', value: 'DEMANDA' }]),
        item,
        columns,
        context,
      ),
    ).toBe(true);
  });

  it('campo desconhecido não casa; grupo vazio casa', () => {
    expect(
      matchesFilter(
        filter([{ field: 'c_nada', operator: 'is_not_empty' }]),
        state({}),
        columns,
        context,
      ),
    ).toBe(false);
    expect(matchesFilter(filter([]), state({}), columns, context)).toBe(true);
  });
});

describe('obrigatoriedade', () => {
  const sei: RequirementColumn = {
    key: 'c_sei',
    type: 'text',
    title: 'Processo SEI',
    binding: null,
    isRequired: false,
    requiredWhen: filter([{ field: 'c_os_emitida', operator: 'is', value: SIM }]),
  };
  const status: RequirementColumn = {
    key: 'c_os_emitida',
    type: 'status',
    title: 'OS emitida',
    binding: null,
    isRequired: false,
    requiredWhen: null,
  };
  const ust: RequirementColumn = {
    key: 'c_ust',
    type: 'number',
    title: 'UST',
    binding: null,
    isRequired: true,
    requiredWhen: null,
  };
  const all = [status, sei, ust];

  it('Gherkin: marcar "OS emitida = Sim" sem Processo SEI exige o preenchimento', () => {
    const before = state({ c_os_emitida: { labelId: NAO }, c_ust: { n: '1' } });
    const after = state({ c_os_emitida: { labelId: SIM }, c_ust: { n: '1' } });
    expect(
      missingRequiredColumns(all, before, after, new Set(['c_os_emitida']), context).map(
        (column) => column.key,
      ),
    ).toEqual(['c_sei']);
    const filled = state({ ...after.values, c_sei: { text: '6011.2026/0001' } });
    expect(
      missingRequiredColumns(all, before, filled, new Set(['c_os_emitida', 'c_sei']), context),
    ).toEqual([]);
  });

  it('item antigo que já viola a regra não bloqueia edição não relacionada', () => {
    const legacy = state({ c_os_emitida: { labelId: SIM }, c_ust: { n: '1' } });
    const renamed = { ...legacy, name: 'Outro nome' };
    expect(missingRequiredColumns(all, legacy, renamed, new Set(['name']), context)).toEqual([]);
  });

  it('obrigatória incondicional: exigida na criação e não pode ser esvaziada', () => {
    expect(
      missingRequiredColumns(all, null, state({}), new Set(), context).map((column) => column.key),
    ).toEqual(['c_ust']);
    const before = state({ c_ust: { n: '2' } });
    expect(
      missingRequiredColumns(all, before, state({}), new Set(['c_ust']), context).map(
        (column) => column.key,
      ),
    ).toEqual(['c_ust']);
  });

  it('isEmptyColumnValue por tipo', () => {
    expect(isEmptyColumnValue('text', { text: '  ' })).toBe(true);
    expect(isEmptyColumnValue('people', { personIds: [], teamIds: ['t'] })).toBe(false);
    expect(isEmptyColumnValue('checkbox', { checked: false })).toBe(true);
    expect(isEmptyColumnValue('timeline', { from: '2026-01-01', to: '2026-01-02' })).toBe(false);
    expect(isEmptyColumnValue('number', { n: '0' })).toBe(false);
  });
});
