import type { ChartOption } from '@cube-track/ui';

import type { BoardColumn, Widget, WidgetData, WidgetLayout, WidgetType } from '@/lib/api/types';

/** Paleta padrão para categorias sem cor própria (coluna sem rótulo/opção colorida). */
const FALLBACK_PALETTE = [
  '#4252d9',
  '#00c875',
  '#fdab3d',
  '#df2f4a',
  '#9149d0',
  '#00a9a5',
  '#ff5ac4',
  '#579bfc',
];

export interface WidgetTypeMeta {
  type: WidgetType;
  icon: 'hash' | 'bar-chart' | 'pie-chart' | 'battery' | 'users' | 'heart-pulse';
}

export const WIDGET_TYPE_META: WidgetTypeMeta[] = [
  { type: 'number', icon: 'hash' },
  { type: 'chart_bar', icon: 'bar-chart' },
  { type: 'chart_pie', icon: 'pie-chart' },
  { type: 'battery', icon: 'battery' },
  { type: 'workload', icon: 'users' },
  { type: 'project_health', icon: 'heart-pulse' },
];

const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  number: { w: 3, h: 2 },
  chart_bar: { w: 6, h: 4 },
  chart_pie: { w: 6, h: 4 },
  battery: { w: 6, h: 2 },
  workload: { w: 12, h: 4 },
  project_health: { w: 12, h: 3 },
};

/** Posição ao final da grade (empilha abaixo do último widget — sem redimensionar/arrastar). */
export function nextWidgetLayout(type: WidgetType, existing: readonly Widget[]): WidgetLayout {
  const bottom = existing.reduce((max, widget) => Math.max(max, widget.layout.y + widget.layout.h), 0);
  return { x: 0, y: bottom, ...DEFAULT_SIZE[type] };
}

/** Ordena widgets por posição na grade (linha, depois coluna) para navegação/reordenação. */
export function sortWidgetsByPosition(widgets: readonly Widget[]): Widget[] {
  return [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
}

const NUMERIC_COLUMN_TYPES = new Set(['number', 'rating', 'time_tracking', 'formula', 'rollup', 'progress']);
const CATEGORY_COLUMN_TYPES = new Set(['status', 'dropdown']);
const DATE_COLUMN_TYPES = new Set(['date', 'timeline']);

export function numericColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => NUMERIC_COLUMN_TYPES.has(column.type));
}
export function categoryColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => CATEGORY_COLUMN_TYPES.has(column.type));
}
export function dateColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => DATE_COLUMN_TYPES.has(column.type));
}
export function peopleColumns(columns: readonly BoardColumn[]): BoardColumn[] {
  return columns.filter((column) => column.type === 'people');
}

/** Opção do ECharts para um widget de barras (`WidgetData` kind `'chart'`). */
export function chartBarOption(data: Extract<WidgetData, { kind: 'chart' }>): ChartOption {
  return {
    grid: { left: 48, right: 16, top: 16, bottom: 48 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: data.categories.map((entry) => entry.label),
      axisLabel: { interval: 0, rotate: data.categories.length > 6 ? 30 : 0 },
    },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        data: data.categories.map((entry, index) => ({
          value: entry.value,
          itemStyle: { color: entry.color ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] },
        })),
      },
    ],
  };
}

/** Opção do ECharts para um widget de pizza (`WidgetData` kind `'chart'`). */
export function chartPieOption(data: Extract<WidgetData, { kind: 'chart' }>): ChartOption {
  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        data: data.categories.map((entry, index) => ({
          name: entry.label,
          value: entry.value,
          itemStyle: { color: entry.color ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] },
        })),
      },
    ],
  };
}
