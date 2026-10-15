import { describe, expect, it } from 'vitest';

import type { BoardColumn } from '@/lib/api/types';

import { activeFilterCount, buildItemQuery, pruneFilter } from './query-builder';

const column = (key: string, type: string): BoardColumn =>
  ({ id: key, key, type, title: key, labels: [], options: [] }) as unknown as BoardColumn;

describe('buildItemQuery', () => {
  it('sem filtros nem ordenação não envia parâmetros', () => {
    expect(buildItemQuery({}, [])).toEqual({});
    expect(activeFilterCount({ search: '   ' })).toBe(0);
  });

  it('busca vai no parâmetro próprio; pessoa (OR entre colunas) e status em AND', () => {
    const query = buildItemQuery(
      { search: ' PMSP ', personId: 'u1', statusLabelIds: ['l1'], sort: 'name:asc' },
      [column('c_owner', 'people'), column('c_team', 'people'), column('c_status', 'status')],
    );
    expect(query.sort).toBe('name:asc');
    expect(query.search).toBe('PMSP');
    expect(JSON.parse(query.filter ?? '')).toEqual({
      op: 'and',
      conditions: [
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
    const single = buildItemQuery({ personId: 'me' }, [column('c_owner', 'people')]);
    expect((JSON.parse(single.filter ?? '') as { conditions: unknown }).conditions).toEqual([
      { field: 'c_owner', operator: 'any_of', value: ['me'] },
    ]);
    expect(buildItemQuery({ personId: 'u1', statusLabelIds: ['l1'] }, [])).toEqual({});
  });

  it('filtro avançado E/OU: descarta rascunhos incompletos e conta condições válidas', () => {
    const filter = {
      op: 'and' as const,
      conditions: [
        { field: 'c_prazo', operator: 'overdue' as const },
        { field: 'c_texto', operator: 'contains' as const, value: '  ' },
        {
          op: 'or' as const,
          conditions: [
            { field: 'c_owner', operator: 'any_of' as const, value: ['me'] },
            { field: 'c_prazo', operator: 'is' as const, value: 'this_week' },
            { field: 'c_status', operator: 'any_of' as const, value: [] },
          ],
        },
        { op: 'and' as const, conditions: [] },
      ],
    };
    expect(pruneFilter(filter)).toEqual({
      op: 'and',
      conditions: [
        { field: 'c_prazo', operator: 'overdue' },
        {
          op: 'or',
          conditions: [
            { field: 'c_owner', operator: 'any_of', value: ['me'] },
            { field: 'c_prazo', operator: 'is', value: 'this_week' },
          ],
        },
      ],
    });
    expect(activeFilterCount({ filter })).toBe(3);
    const query = buildItemQuery({ filter }, []);
    expect(JSON.parse(query.filter ?? '')).toEqual({
      op: 'and',
      conditions: [pruneFilter(filter)],
    });
    expect(buildItemQuery({ filter: { op: 'and', conditions: [] } }, [])).toEqual({});
  });
});
