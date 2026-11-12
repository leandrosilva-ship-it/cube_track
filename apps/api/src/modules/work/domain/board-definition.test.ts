import { describe, expect, it } from 'vitest';

import {
  isItemDone,
  mainStatusColumn,
  parseRequiredWhen,
  toComputedColumns,
  toComputedItem,
  toItemState,
  toRequirementColumns,
  todayIn,
  type BoardDefinition,
  type ColumnDefinition,
  type ItemSnapshotLike,
} from './board-definition.js';

function column(overrides: Partial<ColumnDefinition> = {}): ColumnDefinition {
  return {
    id: 'col-1',
    key: 'c_status',
    type: 'status',
    title: 'Status',
    description: null,
    binding: null,
    settings: {},
    isRequired: false,
    requiredWhen: null,
    defaultValue: null,
    position: 'a0',
    width: null,
    labels: [],
    options: [],
    ...overrides,
  };
}

const doneLabel = { id: 'l-done', label: 'Feito', color: '#0f0', category: 'done' as const, position: 'a0' };
const todoLabel = { id: 'l-todo', label: 'A fazer', color: '#ccc', category: 'not_started' as const, position: 'a1' };

function board(columns: ColumnDefinition[], settings: Record<string, unknown> = {}): BoardDefinition {
  return { boardId: 'b1', workspaceId: 'w1', settings, columns };
}

describe('parseRequiredWhen', () => {
  it('null/undefined viram null', () => {
    expect(parseRequiredWhen(null)).toBeNull();
    expect(parseRequiredWhen(undefined)).toBeNull();
  });

  it('um FilterGroup válido é mantido', () => {
    const valid = { op: 'and', conditions: [{ field: 'c_status', operator: 'is_empty' }] };
    expect(parseRequiredWhen(valid)).toEqual(valid);
  });

  it('um valor inválido (não é FilterGroup) vira null, sem lançar', () => {
    expect(parseRequiredWhen({ nada: 'a ver' })).toBeNull();
    expect(parseRequiredWhen('string qualquer')).toBeNull();
    expect(parseRequiredWhen(42)).toBeNull();
  });
});

describe('mainStatusColumn', () => {
  it('usa settings.statusColumnKey quando aponta para uma coluna de status existente', () => {
    const outro = column({ key: 'c_outro_status', labels: [doneLabel] });
    const principal = column({ key: 'c_principal', labels: [todoLabel] });
    const def = board([outro, principal], { statusColumnKey: 'c_principal' });
    expect(mainStatusColumn(def)?.key).toBe('c_principal');
  });

  it('cai para "c_status" quando statusColumnKey não está configurado ou não bate', () => {
    const cStatus = column({ key: 'c_status', labels: [doneLabel] });
    const outro = column({ key: 'c_outro', labels: [todoLabel] });
    expect(mainStatusColumn(board([outro, cStatus], {}))?.key).toBe('c_status');
    expect(mainStatusColumn(board([outro, cStatus], { statusColumnKey: 'inexistente' }))?.key).toBe(
      'c_status',
    );
  });

  it('sem "c_status" nem configuração, usa a primeira coluna de status', () => {
    const primeira = column({ key: 'c_a', labels: [todoLabel] });
    const segunda = column({ key: 'c_b', labels: [doneLabel] });
    expect(mainStatusColumn(board([primeira, segunda], {}))?.key).toBe('c_a');
  });

  it('sem nenhuma coluna de status, retorna null', () => {
    const texto = column({ key: 'c_texto', type: 'text', labels: [] });
    expect(mainStatusColumn(board([texto], {}))).toBeNull();
  });
});

describe('isItemDone', () => {
  const status = column({ key: 'c_status', labels: [todoLabel, doneLabel] });
  const def = board([status], {});

  it('true quando o rótulo selecionado tem categoria "done"', () => {
    expect(isItemDone(def, { c_status: { labelId: 'l-done' } })).toBe(true);
  });

  it('false quando o rótulo selecionado não é "done"', () => {
    expect(isItemDone(def, { c_status: { labelId: 'l-todo' } })).toBe(false);
  });

  it('false quando não há coluna de status principal', () => {
    expect(isItemDone(board([column({ type: 'text', labels: [] })], {}), {})).toBe(false);
  });

  it('false quando o valor da coluna está ausente ou malformado', () => {
    expect(isItemDone(def, {})).toBe(false);
    expect(isItemDone(def, { c_status: 'não é objeto' })).toBe(false);
  });
});

const snapshot: ItemSnapshotLike = {
  name: 'Item de teste',
  groupId: 'g1',
  values: { c_status: { labelId: 'l-done' } },
  plannedStartDate: '2026-01-01',
  plannedEndDate: '2026-01-10',
  replannedStartDate: null,
  replannedEndDate: null,
  actualStartDate: null,
  actualEndDate: null,
  progress: '50.00',
};

describe('toItemState', () => {
  const def = board([column({ key: 'c_status', labels: [todoLabel, doneLabel] })], {});

  it('mapeia campos nativos para snake_case e marca "completed" pelo status principal', () => {
    const state = toItemState(def, snapshot);
    expect(state.fields.planned_start_date).toBe('2026-01-01');
    expect(state.fields.planned_end_date).toBe('2026-01-10');
    expect(state.fields.replanned_start_date).toBeNull();
    expect(state.completed).toBe(true);
    expect(state.name).toBe('Item de teste');
    expect(state.groupId).toBe('g1');
  });

  it('inclui created_at/updated_at só quando informados no snapshot', () => {
    const withTimestamps = toItemState(def, {
      ...snapshot,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-02T10:00:00Z'),
    });
    expect(withTimestamps.fields.created_at).toBe('2026-01-01T10:00:00.000Z');
    expect(withTimestamps.fields.updated_at).toBe('2026-01-02T10:00:00.000Z');
    const without = toItemState(def, snapshot);
    expect(without.fields.created_at).toBeUndefined();
    expect(without.fields.updated_at).toBeUndefined();
  });
});

describe('toComputedItem', () => {
  it('monta o ComputedItem com datas ISO e os campos nativos mapeados', () => {
    const computed = toComputedItem({
      ...snapshot,
      id: 'i1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });
    expect(computed.id).toBe('i1');
    expect(computed.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(computed.fields.progress).toBe('50.00');
    expect(computed.fields.planned_end_date).toBe('2026-01-10');
  });
});

describe('toComputedColumns / toRequirementColumns', () => {
  const requiredWhen = { op: 'and' as const, conditions: [] };
  const col = column({
    key: 'c_sei',
    type: 'text',
    binding: null,
    isRequired: true,
    requiredWhen,
    labels: [doneLabel],
    options: [{ id: 'o1', label: 'Opção', color: null, position: 'a0' }],
  });
  const def = board([col], {});

  it('toComputedColumns projeta só os campos que o motor de fórmula/agregação precisa', () => {
    const [computed] = toComputedColumns(def);
    expect(computed).toEqual({
      key: 'c_sei',
      type: 'text',
      title: 'Status',
      binding: null,
      settings: {},
      labels: [doneLabel],
      options: [{ id: 'o1', label: 'Opção', color: null, position: 'a0' }],
    });
  });

  it('toRequirementColumns projeta obrigatoriedade e a condição', () => {
    const [requirement] = toRequirementColumns(def);
    expect(requirement).toEqual({
      key: 'c_sei',
      type: 'text',
      title: 'Status',
      binding: null,
      isRequired: true,
      requiredWhen,
    });
  });
});

describe('todayIn', () => {
  it('formata a data no fuso informado (AAAA-MM-DD)', () => {
    // 2026-01-01T02:00:00Z ainda é 2025-12-31 em America/Sao_Paulo (UTC-3), mas já é 2026-01-01 em UTC.
    const instant = new Date('2026-01-01T02:00:00Z');
    expect(todayIn('UTC', instant)).toBe('2026-01-01');
    expect(todayIn('America/Sao_Paulo', instant)).toBe('2025-12-31');
  });
});
