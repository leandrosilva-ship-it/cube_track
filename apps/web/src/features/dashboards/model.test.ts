import { describe, expect, it } from 'vitest';

import type { BoardColumn, Widget } from '@/lib/api/types';

import {
  categoryColumns,
  chartBarOption,
  chartPieOption,
  dateColumns,
  nextWidgetLayout,
  numericColumns,
  peopleColumns,
  sortWidgetsByPosition,
} from './model';

function column(key: string, type: string): BoardColumn {
  return {
    id: key,
    key,
    type,
    title: key,
    description: null,
    settings: {},
    binding: null,
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

function widget(id: string, layout: Widget['layout']): Widget {
  return {
    id,
    dashboardId: 'd1',
    type: 'number',
    title: id,
    config: {},
    layout,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('nextWidgetLayout', () => {
  it('empilha abaixo do último widget existente', () => {
    const existing = [widget('w1', { x: 0, y: 0, w: 3, h: 2 }), widget('w2', { x: 3, y: 0, w: 3, h: 2 })];
    expect(nextWidgetLayout('chart_bar', existing)).toEqual({ x: 0, y: 2, w: 6, h: 4 });
  });

  it('começa em y=0 sem widgets existentes', () => {
    expect(nextWidgetLayout('number', [])).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });
});

describe('sortWidgetsByPosition', () => {
  it('ordena por linha e depois por coluna', () => {
    const widgets = [
      widget('bottom-right', { x: 6, y: 2, w: 6, h: 2 }),
      widget('top-left', { x: 0, y: 0, w: 3, h: 2 }),
      widget('top-right', { x: 3, y: 0, w: 3, h: 2 }),
    ];
    expect(sortWidgetsByPosition(widgets).map((entry) => entry.id)).toEqual([
      'top-left',
      'top-right',
      'bottom-right',
    ]);
  });
});

describe('filtros de coluna por tipo', () => {
  const columns = [
    column('c_ust', 'number'),
    column('c_status', 'status'),
    column('c_frente', 'dropdown'),
    column('c_prazo', 'date'),
    column('c_responsaveis', 'people'),
    column('c_nome', 'text'),
  ];

  it('numericColumns retorna apenas colunas numéricas', () => {
    expect(numericColumns(columns).map((c) => c.key)).toEqual(['c_ust']);
  });
  it('categoryColumns retorna status e dropdown', () => {
    expect(categoryColumns(columns).map((c) => c.key)).toEqual(['c_status', 'c_frente']);
  });
  it('dateColumns retorna apenas colunas de data', () => {
    expect(dateColumns(columns).map((c) => c.key)).toEqual(['c_prazo']);
  });
  it('peopleColumns retorna apenas colunas de pessoas', () => {
    expect(peopleColumns(columns).map((c) => c.key)).toEqual(['c_responsaveis']);
  });
});

describe('opções de gráfico', () => {
  const data = {
    kind: 'chart' as const,
    categories: [
      { key: 'a', label: 'Feito', value: 5, color: '#00c875' },
      { key: 'b', label: 'Pendente', value: 2, color: null },
    ],
  };

  it('chartBarOption gera eixo de categorias e série de barras', () => {
    const option = chartBarOption(data);
    expect(option.xAxis).toMatchObject({ type: 'category', data: ['Feito', 'Pendente'] });
    expect(option.series).toHaveLength(1);
  });

  it('chartPieOption gera série de pizza com os mesmos rótulos', () => {
    const option = chartPieOption(data);
    const series = option.series as { data: { name: string; value: number }[] }[];
    expect(series[0]?.data.map((entry) => entry.name)).toEqual(['Feito', 'Pendente']);
  });
});
