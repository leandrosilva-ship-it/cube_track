import { describe, expect, it } from 'vitest';

import type { BoardColumn } from '@/lib/api/types';

import { activeFilterCount, buildItemQuery } from './query-builder';

const column = (key: string, type: string): BoardColumn =>
  ({ id: key, key, type, title: key, labels: [], options: [] }) as unknown as BoardColumn;

describe('buildItemQuery', () => {
  it('sem filtros nem ordenação não envia parâmetros', () => {
    expect(buildItemQuery({}, [])).toEqual({});
    expect(activeFilterCount({ search: '   ' })).toBe(0);
  });

  it('combina busca, pessoa (OR entre colunas de pessoas) e status em AND', () => {
    const query = buildItemQuery(
      { search: ' PMSP ', personId: 'u1', statusLabelIds: ['l1'], sort: 'name:asc' },
      [column('c_owner', 'people'), column('c_team', 'people'), column('c_status', 'status')],
    );
    expect(query.sort).toBe('name:asc');
    expect(JSON.parse(query.filter ?? '')).toEqual({
      op: 'and',
      conditions: [
        { field: 'name', operator: 'contains', value: 'PMSP' },
        {
          op: 'or',
          conditions: [
            { field: 'c_owner', operator: 'any_of', value: ['u1'] },
            { field: 'c_team', operator: 'any_of', value: ['u1'] },
          ],
        },
        { field: 'c_status', operator: 'any_of', value: ['l1'] },
      ],
    });
    expect(activeFilterCount({ search: 'x', personId: 'u1', statusLabelIds: ['l1'] })).toBe(3);
  });

  it('uma única coluna de pessoas vira condição direta; sem coluna, o filtro é ignorado', () => {
    const single = buildItemQuery({ personId: 'u1' }, [column('c_owner', 'people')]);
    expect((JSON.parse(single.filter ?? '') as { conditions: unknown }).conditions).toEqual([
      { field: 'c_owner', operator: 'any_of', value: ['u1'] },
    ]);
    expect(buildItemQuery({ personId: 'u1', statusLabelIds: ['l1'] }, [])).toEqual({});
  });
});
