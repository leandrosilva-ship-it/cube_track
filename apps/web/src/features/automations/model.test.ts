import { parseActions, parseTrigger } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import type { BoardColumn } from '@/lib/api/types';

import {
  actionSummary,
  buildConditions,
  buttonColumns,
  conditionsToRows,
  dateColumns,
  peopleColumns,
  statusColumns,
  triggerSummary,
  writableColumns,
  type ConditionRow,
} from './model';

function column(key: string, type: string, binding: string | null = null): BoardColumn {
  return {
    id: key,
    key,
    type,
    title: `Coluna ${key}`,
    description: null,
    settings: {},
    binding,
    isRequired: false,
    requiredWhen: null,
    defaultValue: null,
    isHidden: false,
    position: 'a0',
    width: null,
    permissions: {},
    canEdit: true,
    labels: [],
    options: [],
  };
}

const columns = [
  column('c_status', 'status'),
  column('c_botao', 'button'),
  column('c_prazo', 'date'),
  column('c_responsaveis', 'people'),
  column('c_formula', 'formula'),
  column('c_nativo', 'text', 'item.name'),
];
const GROUP_ID = '0190a000-0000-7000-8000-000000000001';
const groups = [{ id: GROUP_ID, name: 'Em andamento' }];

describe('filtros de coluna', () => {
  it('statusColumns/buttonColumns/dateColumns/peopleColumns filtram pelo tipo', () => {
    expect(statusColumns(columns).map((c) => c.key)).toEqual(['c_status']);
    expect(buttonColumns(columns).map((c) => c.key)).toEqual(['c_botao']);
    expect(dateColumns(columns).map((c) => c.key)).toEqual(['c_prazo']);
    expect(peopleColumns(columns).map((c) => c.key)).toEqual(['c_responsaveis']);
  });

  it('writableColumns exclui colunas calculadas e vinculadas', () => {
    expect(writableColumns(columns).map((c) => c.key)).toEqual([
      'c_status',
      'c_prazo',
      'c_responsaveis',
    ]);
  });
});

describe('triggerSummary', () => {
  it('item_created sem grupo e com grupo', () => {
    expect(triggerSummary(parseTrigger({ type: 'item_created', config: {} }), columns, groups)).toEqual({
      key: 'summary.trigger.itemCreatedAny',
    });
    expect(
      triggerSummary(
        parseTrigger({ type: 'item_created', config: { groupId: GROUP_ID } }),
        columns,
        groups,
      ),
    ).toEqual({ key: 'summary.trigger.itemCreatedGroup', values: { group: 'Em andamento' } });
  });

  it('column_value_changed resolve o título da coluna', () => {
    expect(
      triggerSummary(
        parseTrigger({ type: 'column_value_changed', config: { columnKey: 'c_status' } }),
        columns,
        groups,
      ),
    ).toEqual({ key: 'summary.trigger.columnChanged', values: { column: 'Coluna c_status' } });
  });

  it('button_clicked resolve o título da coluna de botão', () => {
    expect(
      triggerSummary(
        parseTrigger({ type: 'button_clicked', config: { columnKey: 'c_botao' } }),
        columns,
        groups,
      ),
    ).toEqual({ key: 'summary.trigger.buttonClicked', values: { column: 'Coluna c_botao' } });
  });

  it('date_arrives: antes, no dia e depois', () => {
    const before = parseTrigger({
      type: 'date_arrives',
      config: { columnKey: 'plannedEndDate', offsetDays: -2 },
    });
    expect(triggerSummary(before, columns, groups)).toEqual({
      key: 'summary.trigger.dateBefore',
      values: { column: 'plannedEndDate', days: 2 },
    });
    const on = parseTrigger({ type: 'date_arrives', config: { columnKey: 'plannedEndDate' } });
    expect(triggerSummary(on, columns, groups)).toEqual({
      key: 'summary.trigger.dateOn',
      values: { column: 'plannedEndDate' },
    });
    const after = parseTrigger({
      type: 'date_arrives',
      config: { columnKey: 'plannedEndDate', offsetDays: 3 },
    });
    expect(triggerSummary(after, columns, groups)).toEqual({
      key: 'summary.trigger.dateAfter',
      values: { column: 'plannedEndDate', days: 3 },
    });
  });
});

describe('actionSummary', () => {
  it('move_to_group, set_column_value e notify', () => {
    const actions = parseActions([
      { type: 'move_to_group', config: { groupId: GROUP_ID } },
      { type: 'set_column_value', config: { columnKey: 'c_status', value: null } },
      { type: 'notify', config: { message: 'Oi' } },
    ]);
    expect(actions).toHaveLength(3);
    const [moveToGroup, setColumn, notify] = actions;
    if (moveToGroup === undefined || setColumn === undefined || notify === undefined) throw new Error();
    expect(actionSummary(moveToGroup, columns, groups)).toEqual({
      key: 'summary.action.moveToGroup',
      values: { group: 'Em andamento' },
    });
    expect(actionSummary(setColumn, columns, groups)).toEqual({
      key: 'summary.action.setColumn',
      values: { column: 'Coluna c_status' },
    });
    expect(actionSummary(notify, columns, groups)).toEqual({ key: 'summary.action.notify' });
  });
});

describe('buildConditions / conditionsToRows', () => {
  it('sem linhas válidas retorna null; com linhas monta {op: and, conditions}', () => {
    expect(buildConditions([])).toBeNull();
    expect(buildConditions([{ field: '', operator: 'is', value: '' }])).toBeNull();
    const rows: ConditionRow[] = [
      { field: 'c_status', operator: 'is', value: 'done' },
      { field: 'c_nome', operator: 'is_empty', value: '' },
    ];
    expect(buildConditions(rows)).toEqual({
      op: 'and',
      conditions: [
        { field: 'c_status', operator: 'is', value: 'done' },
        { field: 'c_nome', operator: 'is_empty' },
      ],
    });
  });

  it('é a inversa de conditionsToRows para o formato gerado', () => {
    const rows: ConditionRow[] = [{ field: 'c_status', operator: 'gte', value: '40' }];
    expect(conditionsToRows(buildConditions(rows))).toEqual(rows);
    expect(conditionsToRows(null)).toEqual([]);
  });
});
