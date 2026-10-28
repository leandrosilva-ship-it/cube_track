import { describe, expect, it } from 'vitest';

import type { Allocation, CapacityHeatmapRow } from '@/lib/api/types';

import {
  allocationOn,
  dateRange,
  daysBetween,
  decodeCellId,
  encodeCellId,
  formatHours,
  groupHeatmapRows,
  planAllocationMove,
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

describe('planAllocationMove', () => {
  const base = { id: 'a1', hoursPerDay: '8' };

  it('alocação de um dia só: remove a original e cria no destino', () => {
    const plan = planAllocationMove({ ...base, startDate: '2026-02-10', endDate: '2026-02-10' }, '2026-02-10', '2026-02-12');
    expect(plan.removeOriginalId).toBe('a1');
    expect(plan.patchOriginal).toBeUndefined();
    expect(plan.extraCreates).toEqual([]);
    expect(plan.targetCreate).toEqual({ startDate: '2026-02-12', endDate: '2026-02-12', hoursPerDay: '8' });
  });

  it('move o primeiro dia: encolhe o início', () => {
    const plan = planAllocationMove({ ...base, startDate: '2026-02-10', endDate: '2026-02-14' }, '2026-02-10', '2026-02-20');
    expect(plan.patchOriginal).toEqual({ id: 'a1', startDate: '2026-02-11', endDate: '2026-02-14' });
    expect(plan.removeOriginalId).toBeUndefined();
    expect(plan.extraCreates).toEqual([]);
  });

  it('move o último dia: encolhe o fim', () => {
    const plan = planAllocationMove({ ...base, startDate: '2026-02-10', endDate: '2026-02-14' }, '2026-02-14', '2026-02-20');
    expect(plan.patchOriginal).toEqual({ id: 'a1', startDate: '2026-02-10', endDate: '2026-02-13' });
  });

  it('move um dia do meio: divide em dois pedaços + o destino', () => {
    const plan = planAllocationMove({ ...base, startDate: '2026-02-10', endDate: '2026-02-14' }, '2026-02-12', '2026-02-20');
    expect(plan.patchOriginal).toEqual({ id: 'a1', startDate: '2026-02-10', endDate: '2026-02-11' });
    expect(plan.extraCreates).toEqual([{ startDate: '2026-02-13', endDate: '2026-02-14', hoursPerDay: '8' }]);
    expect(plan.targetCreate).toEqual({ startDate: '2026-02-20', endDate: '2026-02-20', hoursPerDay: '8' });
  });
});

describe('encodeCellId/decodeCellId', () => {
  it('é reversível', () => {
    expect(decodeCellId(encodeCellId('u1', '2026-02-10'))).toEqual({ userId: 'u1', date: '2026-02-10' });
  });

  it('entrada inválida retorna null', () => {
    expect(decodeCellId('sem-separador')).toBeNull();
  });
});

describe('allocationOn', () => {
  const allocations: Allocation[] = [
    {
      id: 'a1',
      userId: 'u1',
      boardId: 'b1',
      itemId: null,
      startDate: '2026-02-10',
      endDate: '2026-02-14',
      hoursPerDay: '8',
      status: 'confirmed',
      notes: null,
    },
  ];

  it('encontra a alocação que cobre a data', () => {
    expect(allocationOn(allocations, 'u1', '2026-02-12')?.id).toBe('a1');
  });

  it('fora do intervalo não encontra', () => {
    expect(allocationOn(allocations, 'u1', '2026-02-20')).toBeUndefined();
  });
});
