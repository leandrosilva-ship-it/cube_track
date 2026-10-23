'use client';

import { BarChart, PieChart } from 'echarts/charts';
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

import { cn } from '../lib/cn';

echarts.use([
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  SVGRenderer,
]);

export type ChartOption = Parameters<echarts.ECharts['setOption']>[0];

export interface ChartProps {
  option: ChartOption;
  className?: string;
  height?: number | string;
  /** Descrição textual do gráfico para leitores de tela (o SVG do ECharts não é navegável). */
  ariaLabel: string;
}

/**
 * Wrapper fino do ECharts (apenas barras/pizza, renderer SVG — sem canvas, mais leve e acessível).
 * Usado pelos widgets de gráfico do Dashboard (ADR 0050).
 */
export function Chart({ option, className, height = 280, ariaLabel }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;
    const instance = echarts.init(node, undefined, { renderer: 'svg' });
    instanceRef.current = instance;
    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={containerRef}
      className={cn('w-full', className)}
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}
