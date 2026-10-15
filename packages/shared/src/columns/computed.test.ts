import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from '../business-days.js';
import {
  aggregateValues,
  computeItemColumns,
  volatileFormulaKeys,
  type ComputedColumn,
  type ComputedItem,
} from './computed.js';

const NOW = '2026-10-14T12:00:00.000Z';
const context = { today: '2026-10-14', now: NOW, calendar: DEFAULT_CALENDAR };

const status = (key: string): ComputedColumn => ({
  key,
  type: 'status',
  title: key,
  binding: null,
  settings: {},
  labels: [
    { id: `${key}-sim`, label: 'Sim', category: 'done' },
    { id: `${key}-nao`, label: 'Não', category: 'not_started' },
  ],
});
const formula = (key: string, expression: string): ComputedColumn => ({
  key,
  type: 'formula',
  title: key,
  binding: null,
  settings: { expression },
});

const columns: ComputedColumn[] = [
  status('c_os_emitida'),
  status('c_status'),
  { key: 'c_ust', type: 'number', title: 'UST', binding: null, settings: {} },
  {
    key: 'c_fim',
    type: 'date',
    title: 'Término planejado',
    binding: 'item.planned_end_date',
    settings: {},
  },
  formula('c_valor', 'IF({c_os_emitida}="Sim", ROUND({c_ust} * 1.15, 2), 0)'),
  formula('c_dobro', '{c_valor} * 2'),
  formula('c_dias', 'DAYS({c_fim}, TODAY())'),
  formula('c_a', '{c_b} + 1'),
  formula('c_b', '{c_a} + 1'),
  {
    key: 'c_prog',
    type: 'progress',
    title: 'Progresso',
    binding: null,
    settings: { mode: 'status_columns' },
  },
];

function item(values: Record<string, unknown>): ComputedItem {
  return {
    id: 'i1',
    name: 'Demanda',
    values,
    fields: { planned_end_date: '2026-10-24' },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('computeItemColumns', () => {
  it('avalia fórmulas em ordem de dependência, progresso por status e marca ciclos', () => {
    const changes = computeItemColumns(
      columns,
      item({
        c_os_emitida: { labelId: 'c_os_emitida-sim' },
        c_ust: { n: '10.5' },
        c_status: { labelId: 'c_status-nao' },
      }),
      context,
    );
    expect(changes.get('c_valor')).toEqual({ n: '12.08', computedAt: NOW });
    expect(changes.get('c_dobro')).toEqual({ n: '24.16', computedAt: NOW });
    expect(changes.get('c_dias')).toEqual({ n: '10', computedAt: NOW });
    expect(changes.get('c_a')).toMatchObject({ error: '#REF!' });
    expect(changes.get('c_prog')).toEqual({ n: '50', computedAt: NOW });
  });

  it('devolve só o que mudou e pode recalcular apenas as voláteis (TODAY)', () => {
    const values = {
      c_ust: { n: '1' },
      c_valor: { n: '0', computedAt: NOW },
      c_dobro: { n: '0', computedAt: NOW },
      c_dias: { n: '10', computedAt: NOW },
    };
    const changes = computeItemColumns(columns, item(values), context, { volatileOnly: true });
    expect([...changes.keys()]).toEqual([]);
    const tomorrow = computeItemColumns(
      columns,
      item(values),
      { ...context, today: '2026-10-15' },
      { volatileOnly: true },
    );
    expect([...tomorrow.entries()]).toEqual([['c_dias', { n: '9', computedAt: NOW }]]);
    expect(volatileFormulaKeys(columns)).toEqual(['c_dias']);
  });

  it('erros de fórmula viram valor com código', () => {
    const changes = computeItemColumns(
      [formula('c_x', '1/0'), formula('c_y', 'IF(')],
      item({}),
      context,
    );
    expect(changes.get('c_x')).toEqual({ text: '#DIV/0!', error: '#DIV/0!', computedAt: NOW });
    expect(changes.get('c_y')).toMatchObject({ error: '#ERROR!' });
  });
});

describe('aggregateValues (rollup/espelho)', () => {
  const sources = [
    { kind: 'number' as const, value: '1.5' },
    { kind: 'number' as const, value: '2.25' },
    null,
  ];
  it('soma, média, mínimo, máximo e contagens em decimal', () => {
    expect(aggregateValues('sum', sources, NOW)).toEqual({ n: '3.75', computedAt: NOW });
    expect(aggregateValues('avg', sources, NOW)).toEqual({ n: '1.875', computedAt: NOW });
    expect(aggregateValues('min', sources, NOW)).toEqual({ n: '1.5', computedAt: NOW });
    expect(aggregateValues('max', sources, NOW)).toEqual({ n: '2.25', computedAt: NOW });
    expect(aggregateValues('count', sources, NOW)).toEqual({ n: '3', computedAt: NOW });
    expect(aggregateValues('count_non_empty', sources, NOW)).toEqual({ n: '2', computedAt: NOW });
    expect(aggregateValues('sum', [], NOW)).toBeNull();
  });

  it('datas, percentual concluído e lista', () => {
    const dates = [
      { kind: 'date' as const, value: '2026-11-01' },
      { kind: 'date' as const, value: '2026-10-01' },
    ];
    expect(aggregateValues('earliest', dates, NOW)).toEqual({ d: '2026-10-01', computedAt: NOW });
    expect(aggregateValues('latest', dates, NOW)).toEqual({ d: '2026-11-01', computedAt: NOW });
    const statuses = [
      { kind: 'status' as const, label: 'Feito', done: true },
      { kind: 'status' as const, label: 'A fazer', done: false },
      null,
      { kind: 'done' as const, value: true },
    ];
    expect(aggregateValues('done_percent', statuses, NOW)).toEqual({ n: '50', computedAt: NOW });
    expect(aggregateValues('list', statuses, NOW)).toEqual({
      text: 'Feito, A fazer, ✓',
      computedAt: NOW,
    });
  });
});
