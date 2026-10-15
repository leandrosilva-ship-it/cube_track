import { describe, expect, it } from 'vitest';

import { assigneeIds, redactValues, toItemDto, type ItemRecord } from './item.js';

const item: ItemRecord = {
  id: 'i',
  tenantId: 't',
  boardId: 'b',
  groupId: 'g',
  parentItemId: null,
  name: 'Demanda',
  position: 'a0',
  values: {
    c_ust: { n: '10' },
    c_status: { labelId: 'x' },
    c_people: { personIds: ['u1'], teamIds: ['t1'] },
  },
  fieldVersions: { c_ust: 3, c_status: 1 },
  version: 4,
  plannedStartDate: '2026-11-01',
  plannedEndDate: '2026-11-30',
  replannedStartDate: null,
  replannedEndDate: null,
  actualStartDate: null,
  actualEndDate: null,
  progress: '10.00',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
  createdBy: null,
  updatedBy: null,
  completedAt: null,
  archivedAt: null,
};

describe('redação de colunas', () => {
  it('remove valores e versões de colunas ocultas', () => {
    const dto = toItemDto(item, { hidden: new Set(['c_ust']), hiddenBindings: new Set() });
    expect(dto.values).not.toHaveProperty('c_ust');
    expect(dto.fieldVersions).toEqual({ c_status: 1 });
    expect(dto.redactedFields).toEqual([]);
  });

  it('anula campos nativos vinculados a colunas ocultas', () => {
    const dto = toItemDto(item, {
      hidden: new Set(['c_prazo']),
      hiddenBindings: new Set(['item.planned_end_date']),
    });
    expect(dto.plannedEndDate).toBeNull();
    expect(dto.plannedStartDate).toBe('2026-11-01');
    expect(dto.redactedFields).toEqual(['plannedEndDate']);
  });

  it('redactValues não altera o original', () => {
    const values = { a: 1, b: 2 };
    expect(redactValues(values, { hidden: new Set(['a']), hiddenBindings: new Set() })).toEqual({
      b: 2,
    });
    expect(values).toEqual({ a: 1, b: 2 });
  });

  it('coleta responsáveis de colunas de pessoas', () => {
    expect(assigneeIds(item.values, ['c_people']).sort()).toEqual(['t1', 'u1']);
    expect(assigneeIds(item.values, [])).toEqual([]);
  });
});
