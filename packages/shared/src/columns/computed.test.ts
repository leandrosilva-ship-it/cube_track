import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from '../business-days.js';
import {
  aggregateValues,
  columnValueToFormula,
  computeItemColumns,
  sourceValue,
  statusProgress,
  storedNumber,
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

  it('min/max caem para datas quando não há números', () => {
    const dates = [
      { kind: 'date' as const, value: '2026-11-01' },
      { kind: 'date' as const, value: '2026-10-01' },
    ];
    expect(aggregateValues('min', dates, NOW)).toEqual({ d: '2026-10-01', computedAt: NOW });
    expect(aggregateValues('max', dates, NOW)).toEqual({ d: '2026-11-01', computedAt: NOW });
    expect(aggregateValues('min', [], NOW)).toBeNull();
    expect(aggregateValues('max', [], NOW)).toBeNull();
    expect(aggregateValues('earliest', [], NOW)).toBeNull();
    expect(aggregateValues('list', [null, null], NOW)).toBeNull();
    expect(aggregateValues('done_percent', [], NOW)).toBeNull();
  });

  it('número fora da faixa de armazenamento vira #NUM!', () => {
    const huge = [{ kind: 'number' as const, value: '99999999999999.9999' }];
    expect(aggregateValues('sum', [...huge, ...huge], NOW)).toEqual({
      text: '#NUM!',
      error: '#NUM!',
      computedAt: NOW,
    });
  });
});

describe('storedNumber', () => {
  it('lê o decimal de um valor armazenado válido', () => {
    expect(storedNumber({ n: '12.5' })?.toString()).toBe('12.5');
  });

  it('retorna null para valor ausente, não-objeto ou sem "n" numérico', () => {
    expect(storedNumber(null)).toBeNull();
    expect(storedNumber('texto')).toBeNull();
    expect(storedNumber({})).toBeNull();
    expect(storedNumber({ n: 'abc' })).toBeNull();
  });
});

describe('statusProgress', () => {
  it('usa sourceColumnKeys explícito quando configurado, em vez de todas as colunas de status', () => {
    const progressColumn: ComputedColumn = {
      key: 'c_prog2',
      type: 'progress',
      title: 'Progresso',
      binding: null,
      settings: { mode: 'status_columns', sourceColumnKeys: ['c_os_emitida'] },
    };
    const value = statusProgress(
      progressColumn,
      columns,
      item({ c_os_emitida: { labelId: 'c_os_emitida-sim' }, c_status: { labelId: 'c_status-nao' } }),
    );
    // Só "c_os_emitida" conta (Sim = done): 100%, mesmo com c_status "Não".
    expect(value).toBe('100');
  });

  it('retorna null quando não há nenhuma coluna de status de origem', () => {
    const progressColumn: ComputedColumn = {
      key: 'c_prog3',
      type: 'progress',
      title: 'Progresso',
      binding: null,
      settings: { sourceColumnKeys: ['inexistente'] },
    };
    expect(statusProgress(progressColumn, columns, item({}))).toBeNull();
  });
});

describe('columnValueToFormula — cada tipo de coluna customizada', () => {
  const names = (id: string) => ({ u1: 'Ana', t1: 'Time X' })[id as 'u1' | 't1'];
  const col = (key: string, type: string, extra: Partial<ComputedColumn> = {}): ComputedColumn => ({
    key,
    type,
    title: key,
    binding: null,
    settings: {},
    ...extra,
  });
  const withValue = (values: Record<string, unknown>): ComputedItem => item(values);

  it('item_id/creation_log/last_updated usam os metadados do item, não `values`', () => {
    expect(columnValueToFormula(col('c', 'item_id'), withValue({}), names)).toEqual({
      kind: 'text',
      value: 'i1',
    });
    expect(columnValueToFormula(col('c', 'creation_log'), withValue({}), names)).toEqual({
      kind: 'datetime',
      value: NOW,
    });
    expect(columnValueToFormula(col('c', 'last_updated'), withValue({}), names)).toEqual({
      kind: 'datetime',
      value: NOW,
    });
  });

  it('coluna vinculada (binding item.*) usa o campo nativo; null/undefined vira vazio', () => {
    const bound = col('c_fim2', 'date', { binding: 'item.planned_end_date' });
    expect(columnValueToFormula(bound, withValue({}), names)).toEqual({ kind: 'date', value: '2026-10-24' });
    const unbound: ComputedItem = { ...withValue({}), fields: { planned_end_date: null } };
    expect(columnValueToFormula(bound, unbound, names)).toEqual({ kind: 'empty' });
    const progressBound = col('c_p', 'progress', { binding: 'item.progress' });
    expect(
      columnValueToFormula(progressBound, { ...withValue({}), fields: { progress: '42' } }, names),
    ).toEqual({ kind: 'number', value: '42' });
  });

  it('valor ausente (não é objeto) vira vazio para qualquer tipo não-vinculado', () => {
    expect(columnValueToFormula(col('c', 'number'), withValue({ c: null }), names)).toEqual({
      kind: 'empty',
    });
    expect(columnValueToFormula(col('c', 'text'), withValue({}), names)).toEqual({ kind: 'empty' });
  });

  it('number/rating/time_tracking lêem o campo "n"', () => {
    expect(columnValueToFormula(col('c', 'rating'), withValue({ c: { n: '4' } }), names)).toEqual({
      kind: 'number',
      value: '4',
    });
    expect(columnValueToFormula(col('c', 'time_tracking'), withValue({ c: {} }), names)).toEqual({
      kind: 'empty',
    });
  });

  it('formula/mirror/rollup/progress: erro > número > data > texto, nessa prioridade', () => {
    const type = 'mirror';
    expect(columnValueToFormula(col('c', type), withValue({ c: { error: '#REF!', n: '1' } }), names)).toEqual({
      kind: 'empty',
    });
    expect(columnValueToFormula(col('c', type), withValue({ c: { n: '5' } }), names)).toEqual({
      kind: 'number',
      value: '5',
    });
    expect(columnValueToFormula(col('c', type), withValue({ c: { d: '2026-01-01' } }), names)).toEqual({
      kind: 'date',
      value: '2026-01-01',
    });
    expect(columnValueToFormula(col('c', type), withValue({ c: { text: 'olá' } }), names)).toEqual({
      kind: 'text',
      value: 'olá',
    });
    expect(columnValueToFormula(col('c', type), withValue({ c: {} }), names)).toEqual({ kind: 'empty' });
  });

  it('date: só data, ou data+hora quando "time" está presente', () => {
    expect(columnValueToFormula(col('c', 'date'), withValue({ c: { d: '2026-01-01' } }), names)).toEqual({
      kind: 'date',
      value: '2026-01-01',
    });
    expect(
      columnValueToFormula(col('c', 'date'), withValue({ c: { d: '2026-01-01', time: '14:30' } }), names),
    ).toEqual({ kind: 'datetime', value: '2026-01-01T14:30:00.000Z' });
    expect(columnValueToFormula(col('c', 'date'), withValue({ c: {} }), names)).toEqual({ kind: 'empty' });
  });

  it('timeline/week: lista [de, até] ou vazio se faltar um dos dois', () => {
    for (const type of ['timeline', 'week']) {
      expect(
        columnValueToFormula(col('c', type), withValue({ c: { from: '2026-01-01', to: '2026-01-10' } }), names),
      ).toEqual({
        kind: 'list',
        items: [
          { kind: 'date', value: '2026-01-01' },
          { kind: 'date', value: '2026-01-10' },
        ],
      });
      expect(columnValueToFormula(col('c', type), withValue({ c: { from: '2026-01-01' } }), names)).toEqual({
        kind: 'empty',
      });
    }
  });

  it('checkbox: boolean a partir de "checked"', () => {
    expect(columnValueToFormula(col('c', 'checkbox'), withValue({ c: { checked: true } }), names)).toEqual({
      kind: 'boolean',
      value: true,
    });
    expect(columnValueToFormula(col('c', 'checkbox'), withValue({ c: {} }), names)).toEqual({
      kind: 'boolean',
      value: false,
    });
  });

  it('status: resolve o rótulo pelo labelId; vazio quando a opção não existe mais', () => {
    const column = status('c');
    expect(columnValueToFormula(column, withValue({ c: { labelId: 'c-sim' } }), names)).toEqual({
      kind: 'text',
      value: 'Sim',
    });
    expect(columnValueToFormula(column, withValue({ c: { labelId: 'apagada' } }), names)).toEqual({
      kind: 'empty',
    });
  });

  it('dropdown: lista de rótulos pelas opções, mantém o id se a opção foi removida', () => {
    const column = col('c', 'dropdown', {
      options: [{ id: 'o1', label: 'Opção 1' }],
    });
    expect(
      columnValueToFormula(column, withValue({ c: { optionIds: ['o1', 'o2'] } }), names),
    ).toEqual({ kind: 'list', items: [{ kind: 'text', value: 'Opção 1' }, { kind: 'text', value: 'o2' }] });
  });

  it('people: junta pessoas e times, resolvendo nomes (ou mantém o id se não resolver)', () => {
    expect(
      columnValueToFormula(
        col('c', 'people'),
        withValue({ c: { personIds: ['u1'], teamIds: ['t1', 't2'] } }),
        names,
      ),
    ).toEqual({
      kind: 'list',
      items: [
        { kind: 'text', value: 'Ana' },
        { kind: 'text', value: 'Time X' },
        { kind: 'text', value: 't2' },
      ],
    });
  });

  it('board_relation: nomes dos itens relacionados', () => {
    expect(
      columnValueToFormula(col('c', 'board_relation'), withValue({ c: { itemIds: ['u1'] } }), names),
    ).toEqual({ kind: 'list', items: [{ kind: 'text', value: 'Ana' }] });
  });

  it('tags: lista de textos', () => {
    expect(columnValueToFormula(col('c', 'tags'), withValue({ c: { tags: ['a', 'b'] } }), names)).toEqual({
      kind: 'list',
      items: [{ kind: 'text', value: 'a' }, { kind: 'text', value: 'b' }],
    });
  });

  it('file/vote: contagem de anexos/votos', () => {
    expect(
      columnValueToFormula(col('c', 'file'), withValue({ c: { attachmentIds: ['a', 'b', 'c'] } }), names),
    ).toEqual({ kind: 'number', value: '3' });
    expect(columnValueToFormula(col('c', 'vote'), withValue({ c: { userIds: ['u1'] } }), names)).toEqual({
      kind: 'number',
      value: '1',
    });
  });

  it('link: texto de exibição ou a própria url como alternativa', () => {
    expect(columnValueToFormula(col('c', 'link'), withValue({ c: { url: 'https://x' } }), names)).toEqual({
      kind: 'text',
      value: 'https://x',
    });
    expect(
      columnValueToFormula(col('c', 'link'), withValue({ c: { text: 'Site', url: 'https://x' } }), names),
    ).toEqual({ kind: 'text', value: 'Site' });
  });

  it('auto_id/text/long_text: texto literal', () => {
    for (const type of ['auto_id', 'text', 'long_text']) {
      expect(columnValueToFormula(col('c', type), withValue({ c: { text: 'valor' } }), names)).toEqual({
        kind: 'text',
        value: 'valor',
      });
    }
  });

  it('tipos não mapeados explicitamente (email/telefone/endereço/cor/hora/código) caem no default', () => {
    expect(columnValueToFormula(col('c', 'email'), withValue({ c: { email: 'a@b.com' } }), names)).toEqual({
      kind: 'text',
      value: 'a@b.com',
    });
    expect(columnValueToFormula(col('c', 'phone'), withValue({ c: { phone: '11999999999' } }), names)).toEqual({
      kind: 'text',
      value: '11999999999',
    });
    expect(columnValueToFormula(col('c', 'color'), withValue({ c: {} }), names)).toEqual({ kind: 'empty' });
  });
});

describe('sourceValue (origem de rollup/espelho)', () => {
  const names = () => undefined;

  it('status: converte para {kind: status, label, done}', () => {
    expect(sourceValue(status('c'), item({ c: { labelId: 'c-sim' } }), names)).toEqual({
      kind: 'status',
      label: 'Sim',
      done: true,
    });
    expect(sourceValue(status('c'), item({ c: { labelId: 'apagada' } }), names)).toBeNull();
  });

  it('demais tipos convertem pelo FormulaValue: número, data, datetime, boolean, texto', () => {
    expect(
      sourceValue({ key: 'c', type: 'number', title: 'c', binding: null, settings: {} }, item({ c: { n: '5' } }), names),
    ).toEqual({ kind: 'number', value: '5' });
    expect(
      sourceValue({ key: 'c', type: 'date', title: 'c', binding: null, settings: {} }, item({ c: { d: '2026-01-01' } }), names),
    ).toEqual({ kind: 'date', value: '2026-01-01' });
    expect(
      sourceValue({ key: 'c', type: 'item_id', title: 'c', binding: null, settings: {} }, item({}), names),
    ).toEqual({ kind: 'text', value: 'i1' });
    expect(
      sourceValue({ key: 'c', type: 'checkbox', title: 'c', binding: null, settings: {} }, item({ c: { checked: true } }), names),
    ).toEqual({ kind: 'done', value: true });
  });

  it('lista vazia vira null; lista com itens vira texto unido por vírgula', () => {
    expect(
      sourceValue({ key: 'c', type: 'tags', title: 'c', binding: null, settings: {} }, item({ c: { tags: [] } }), names),
    ).toBeNull();
    expect(
      sourceValue({ key: 'c', type: 'tags', title: 'c', binding: null, settings: {} }, item({ c: { tags: ['a', 'b'] } }), names),
    ).toEqual({ kind: 'text', value: 'a, b' });
  });

  it('vazio (empty) vira null — tipo sem nenhum valor mapeável', () => {
    expect(
      sourceValue({ key: 'c', type: 'text', title: 'c', binding: null, settings: {} }, item({}), names),
    ).toBeNull();
  });
});
