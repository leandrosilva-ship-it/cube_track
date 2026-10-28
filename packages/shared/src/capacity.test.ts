import { describe, expect, it } from 'vitest';

import { DEFAULT_CALENDAR } from './business-days.js';
import {
  aggregateCapacityDays,
  dailyCapacity,
  dateRange,
  isoWeekStart,
  monthlyBuckets,
  suggestLeveling,
} from './capacity.js';

describe('isoWeekStart', () => {
  it('segunda-feira retorna ela mesma', () => {
    expect(isoWeekStart('2026-03-02')).toBe('2026-03-02');
  });

  it('domingo retorna a segunda-feira anterior', () => {
    expect(isoWeekStart('2026-03-08')).toBe('2026-03-02');
  });

  it('atravessa a virada de mês corretamente', () => {
    expect(isoWeekStart('2026-03-01')).toBe('2026-02-23');
  });
});

describe('dateRange', () => {
  it('lista todas as datas inclusive', () => {
    expect(dateRange('2026-03-02', '2026-03-04')).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
  });
});

describe('dailyCapacity', () => {
  it('fim de semana tem capacidade nominal zero', () => {
    // 2026-03-02 é segunda; 07/08 são sábado/domingo.
    const days = dailyCapacity({
      from: '2026-03-07',
      to: '2026-03-08',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [],
    });
    expect(days.every((day) => day.nominalHours === 0 && day.availableHours === 0)).toBe(true);
  });

  it('ausência de dia inteiro zera a disponibilidade; ausência parcial só reduz', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-03',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [
        { startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: null },
        { startDate: '2026-03-03', endDate: '2026-03-03', hoursPerDay: 3 },
      ],
      allocations: [],
    });
    expect(days[0]?.availableHours).toBe(0);
    expect(days[1]?.availableHours).toBe(5);
  });

  it('marca sobrealocação quando alocado excede disponível, e ociosidade quando não há alocação', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-02',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [
        { startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 5 },
        { startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 4 },
      ],
    });
    expect(days[0]).toMatchObject({ allocatedHours: 9, availableHours: 8, overallocated: true, idle: false });

    const idle = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-02',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [],
    });
    expect(idle[0]).toMatchObject({ overallocated: false, idle: true });
  });

  it('soma só as alocações cujo intervalo cobre o dia', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-04',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [{ startDate: '2026-03-02', endDate: '2026-03-03', hoursPerDay: 4 }],
    });
    expect(days.map((day) => day.allocatedHours)).toEqual([4, 4, 0]);
  });
});

describe('suggestLeveling', () => {
  it('sugere mover o excedente de um dia sobrealocado para um dia seguinte com folga', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-03',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [{ startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 10 }],
    });
    const suggestions = suggestLeveling({
      from: '2026-03-02',
      to: '2026-03-03',
      days,
      allocations: [
        { id: 'a1', userId: 'u1', startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 10 },
      ],
    });
    expect(suggestions).toEqual([
      { userId: 'u1', allocationId: 'a1', fromDate: '2026-03-02', toDate: '2026-03-03', hours: 2 },
    ]);
  });

  it('não sugere nada quando ninguém está sobrealocado', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-02',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [{ startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 4 }],
    });
    expect(
      suggestLeveling({
        from: '2026-03-02',
        to: '2026-03-02',
        days,
        allocations: [{ id: 'a1', userId: 'u1', startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 4 }],
      }),
    ).toEqual([]);
  });
});

describe('aggregateCapacityDays', () => {
  it('granularidade dia retorna os próprios dias', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-02',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [],
    });
    expect(aggregateCapacityDays(days, 'day')).toEqual([
      { bucket: '2026-03-02', nominalHours: 8, availableHours: 8, allocatedHours: 0, utilization: 0, overallocated: false },
    ]);
  });

  it('granularidade semana soma a semana inteira (segunda a domingo)', () => {
    const days = dailyCapacity({
      from: '2026-03-02',
      to: '2026-03-08',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [{ startDate: '2026-03-02', endDate: '2026-03-02', hoursPerDay: 8 }],
    });
    const buckets = aggregateCapacityDays(days, 'week');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ bucket: '2026-03-02', nominalHours: 40, availableHours: 40, allocatedHours: 8 });
  });

  it('granularidade mês agrupa pelo primeiro dia do mês', () => {
    const days = dailyCapacity({
      from: '2026-02-27',
      to: '2026-03-02',
      calendar: DEFAULT_CALENDAR,
      hoursPerDay: 8,
      absences: [],
      allocations: [],
    });
    const buckets = aggregateCapacityDays(days, 'month');
    expect(buckets.map((bucket) => bucket.bucket)).toEqual(['2026-02-01', '2026-03-01']);
  });
});

describe('monthlyBuckets', () => {
  it('gera N baldes mensais consecutivos a partir do mês de referência', () => {
    const buckets = monthlyBuckets('2026-03-15', 3);
    expect(buckets).toEqual([
      { month: '2026-03-01', start: '2026-03-01', end: '2026-03-31' },
      { month: '2026-04-01', start: '2026-04-01', end: '2026-04-30' },
      { month: '2026-05-01', start: '2026-05-01', end: '2026-05-31' },
    ]);
  });

  it('atravessa a virada de ano corretamente', () => {
    const buckets = monthlyBuckets('2026-11-10', 3);
    expect(buckets.map((bucket) => bucket.month)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(buckets[1]).toMatchObject({ end: '2026-12-31' });
  });
});
