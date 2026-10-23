import { describe, expect, it } from 'vitest';

import {
  ChartBarWidgetConfigSchema,
  ChartPieWidgetConfigSchema,
  NumberWidgetConfigSchema,
  WidgetFilterSchema,
  WidgetLayoutSchema,
  isGroupFilter,
  isWidgetType,
  parseWidgetConfig,
} from './widgets.js';

describe('isWidgetType', () => {
  it('reconhece os tipos registrados', () => {
    expect(isWidgetType('number')).toBe(true);
    expect(isWidgetType('chart_bar')).toBe(true);
    expect(isWidgetType('gauge')).toBe(false);
  });
});

describe('WidgetFilterSchema', () => {
  it('aceita filtro por grupos', () => {
    const filter = { groupIds: ['018f1e2a-0000-7000-8000-000000000001'] };
    expect(WidgetFilterSchema.safeParse(filter).success).toBe(true);
    expect(isGroupFilter(WidgetFilterSchema.parse(filter))).toBe(true);
  });

  it('aceita filtro por condição de coluna', () => {
    const filter = { columnKey: 'c_faturamento', operator: 'is_not_empty' };
    const parsed = WidgetFilterSchema.parse(filter);
    expect(isGroupFilter(parsed)).toBe(false);
  });

  it('rejeita formas desconhecidas', () => {
    expect(WidgetFilterSchema.safeParse({ foo: 'bar' }).success).toBe(false);
  });
});

describe('parseWidgetConfig — number', () => {
  it('exige boardIds e aggregate', () => {
    const config = { boardIds: ['018f1e2a-0000-7000-8000-000000000001'], columnKey: 'c_ust', aggregate: 'sum' };
    expect(parseWidgetConfig('number', config)).toEqual(config);
    expect(() => parseWidgetConfig('number', { boardIds: [] })).toThrow();
  });

  it('permite columnKey ausente (contagem de itens)', () => {
    const config = { boardIds: ['018f1e2a-0000-7000-8000-000000000001'], aggregate: 'count' };
    expect(NumberWidgetConfigSchema.safeParse(config).success).toBe(true);
  });
});

describe('parseWidgetConfig — chart_bar/chart_pie', () => {
  it('chart_bar exige xColumnKey', () => {
    expect(
      ChartBarWidgetConfigSchema.safeParse({
        boardIds: ['018f1e2a-0000-7000-8000-000000000001'],
        xColumnKey: 'c_frente',
        yColumnKey: 'c_ust',
        aggregate: 'sum',
      }).success,
    ).toBe(true);
  });

  it('chart_pie exige columnKey', () => {
    expect(
      ChartPieWidgetConfigSchema.safeParse({
        boardIds: ['018f1e2a-0000-7000-8000-000000000001'],
        columnKey: 'c_status',
      }).success,
    ).toBe(true);
    expect(ChartPieWidgetConfigSchema.safeParse({ boardIds: [] }).success).toBe(false);
  });
});

describe('WidgetLayoutSchema', () => {
  it('aceita a grade de 12 colunas', () => {
    expect(WidgetLayoutSchema.safeParse({ x: 0, y: 6, w: 12, h: 4 }).success).toBe(true);
    expect(WidgetLayoutSchema.safeParse({ x: 0, y: 0, w: 13, h: 1 }).success).toBe(false);
  });
});
