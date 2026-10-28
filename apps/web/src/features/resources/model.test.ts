import { describe, expect, it } from 'vitest';

import type { CapacityHeatmapRow } from '@/lib/api/types';

import {
  dateRange,
  daysBetween,
  formatHours,
  groupHeatmapRows,
  shiftDate,
  utilizationLevel,
} from './model';

describe('dateRange', () => {
  it('lista as datas entre from e to, inclusive', () => {
    expect(dateRange('2026-01-29', '2026-02-02')).toEqual([
      '2026-01-29',
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('data única retorna um item', () => {
    expect(dateRange('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });
});

describe('shiftDate', () => {
  it('avança dias cruzando mês/ano', () => {
    expect(shiftDate('2025-12-30', 3)).toBe('2026-01-02');
  });

  it('aceita deslocamento negativo', () => {
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('daysBetween', () => {
  it('calcula a diferença em dias inteiros', () => {
    expect(daysBetween('2026-01-01', '2026-01-10')).toBe(9);
    expect(daysBetween('2026-01-10', '2026-01-01')).toBe(-9);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('utilizationLevel', () => {
  it('sobrealocado vence qualquer outra condição', () => {
    expect(utilizationLevel({ utilization: 0.5, overallocated: true })).toBe('over');
  });

  it('zero utilização é ociosa', () => {
    expect(utilizationLevel({ utilization: 0, overallocated: false })).toBe('idle');
  });

  it('acima de 85% é alta', () => {
    expect(utilizationLevel({ utilization: 0.9, overallocated: false })).toBe('high');
  });

  it('entre 0 e 85% é normal', () => {
    expect(utilizationLevel({ utilization: 0.5, overallocated: false })).toBe('normal');
  });
});

describe('formatHours', () => {
  it('remove zeros à direita', () => {
    expect(formatHours('4.00')).toBe('4');
    expect(formatHours('7.50')).toBe('7.5');
    expect(formatHours(8)).toBe('8');
  });

  it('entrada inválida vira zero', () => {
    expect(formatHours('abc')).toBe('0');
  });
});

describe('groupHeatmapRows', () => {
  const rows: CapacityHeatmapRow[] = [
    {
      userId: 'u1',
      userName: 'Bia',
      teamIds: ['t1'],
      skillIds: ['s1'],
      buckets: [{ bucket: '2026-01-01', nominalHours: 8, availableHours: 8, allocatedHours: 4, utilization: 0.5, overallocated: false }],
    },
    {
      userId: 'u2',
      userName: 'Ana',
      teamIds: ['t1', 't2'],
      skillIds: [],
      buckets: [{ bucket: '2026-01-01', nominalHours: 8, availableHours: 8, allocatedHours: 10, utilization: 1.25, overallocated: true }],
    },
  ];

  it('agrupamento por pessoa ordena por nome e não soma nada', () => {
    const groups = groupHeatmapRows(rows, 'person', new Map(), new Map());
    expect(groups.map((g) => g.label)).toEqual(['Ana', 'Bia']);
    expect(groups[0]?.rows).toHaveLength(1);
  });

  it('agrupamento por time soma os buckets e repete membros em múltiplos times', () => {
    const groups = groupHeatmapRows(rows, 'team', new Map([['t1', 'Time 1'], ['t2', 'Time 2']]), new Map());
    const team1 = groups.find((g) => g.key === 't1');
    expect(team1?.rows).toHaveLength(2);
    expect(team1?.totals[0]?.allocatedHours).toBe(14);
    const team2 = groups.find((g) => g.key === 't2');
    expect(team2?.rows).toHaveLength(1);
  });

  it('agrupamento por skill usa "—" para quem não tem nenhuma', () => {
    const groups = groupHeatmapRows(rows, 'skill', new Map(), new Map([['s1', 'TypeScript']]));
    expect(groups.find((g) => g.key === 's1')?.label).toBe('TypeScript');
    expect(groups.find((g) => g.key === '__none__')?.label).toBe('—');
  });
});
