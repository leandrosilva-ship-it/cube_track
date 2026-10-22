import { describe, expect, it } from 'vitest';

import { buildTicks, daysBetween, dateToX, defaultRange, durationPx, xToDate } from './timeline.js';

describe('daysBetween / dateToX / xToDate', () => {
  it('calcula dias corridos (pode ser negativo)', () => {
    expect(daysBetween('2026-01-01', '2026-01-10')).toBe(9);
    expect(daysBetween('2026-01-10', '2026-01-01')).toBe(-9);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('converte data -> x e x -> data de forma inversa', () => {
    const rangeStart = '2026-01-01';
    const pxPerDay = 20;
    expect(dateToX('2026-01-11', rangeStart, pxPerDay)).toBe(200);
    expect(xToDate(200, rangeStart, pxPerDay)).toBe('2026-01-11');
    expect(xToDate(0, rangeStart, pxPerDay)).toBe(rangeStart);
  });
});

describe('durationPx', () => {
  it('cobre start..end inclusive e nunca fica menor que um dia (marco)', () => {
    expect(durationPx('2026-01-01', '2026-01-05', 10)).toBe(50);
    expect(durationPx('2026-01-01', '2026-01-01', 10)).toBe(10);
  });
});

describe('buildTicks', () => {
  it('zoom "day": um tick por dia, marcando início de mês', () => {
    const ticks = buildTicks({ start: '2026-01-30', end: '2026-02-02' }, 'day');
    expect(ticks.map((tick) => tick.date)).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(ticks.find((tick) => tick.date === '2026-02-01')?.major).toBe(true);
    expect(ticks.find((tick) => tick.date === '2026-01-30')?.major).toBe(false);
  });

  it('zoom "week": um tick a cada 7 dias', () => {
    const ticks = buildTicks({ start: '2026-01-01', end: '2026-01-22' }, 'week');
    expect(ticks.map((tick) => tick.date)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']);
  });

  it('zoom "month": um tick por mês, marcando início de ano', () => {
    const ticks = buildTicks({ start: '2025-11-15', end: '2026-02-10' }, 'month');
    expect(ticks.map((tick) => tick.date)).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
    expect(ticks.find((tick) => tick.date === '2026-01-01')?.major).toBe(true);
  });

  it('zoom "year": um tick por trimestre', () => {
    const ticks = buildTicks({ start: '2026-01-01', end: '2026-12-31' }, 'year');
    expect(ticks.map((tick) => tick.date)).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ]);
  });
});

describe('defaultRange', () => {
  it('cobre a tarefa mais cedo/tarde com a margem pedida', () => {
    const range = defaultRange(
      [
        { start: '2026-03-10', end: '2026-03-20' },
        { start: '2026-03-01', end: '2026-03-05' },
        { start: null, end: null },
      ],
      3,
    );
    expect(range).toEqual({ start: '2026-02-26', end: '2026-03-23' });
  });

  it('sem tarefas datadas, usa hoje ± margem', () => {
    expect(defaultRange([], 5, '2026-06-15')).toEqual({ start: '2026-06-10', end: '2026-06-20' });
  });
});
