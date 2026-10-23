import { describe, expect, it } from 'vitest';

import {
  defaultKanbanConfig,
  IMPLEMENTED_VIEW_TYPES,
  isViewType,
  KanbanConfigSchema,
  parseViewConfig,
  TableConfigSchema,
  viewSortToQueryString,
  ViewSortTermSchema,
} from './views.js';

describe('tipos de view', () => {
  it('valida e rejeita tipos', () => {
    expect(isViewType('kanban')).toBe(true);
    expect(isViewType('invalido')).toBe(false);
  });
});

describe('ordenação salva', () => {
  it('converte para o parâmetro de consulta (field:dir)', () => {
    const terms = [
      ViewSortTermSchema.parse({ columnKey: 'c_status', direction: 'asc' }),
      ViewSortTermSchema.parse({ columnKey: 'c_prazo', direction: 'desc' }),
    ];
    expect(viewSortToQueryString(terms)).toBe('c_status:asc,c_prazo:desc');
    expect(viewSortToQueryString([])).toBeUndefined();
  });
});

describe('configuração do Kanban', () => {
  it('aplica os valores padrão', () => {
    const config = defaultKanbanConfig('c_frente');
    expect(config).toEqual({
      columnsBy: 'c_frente',
      cardFields: [],
      cardDensity: 'detailed',
      showCover: false,
      wipLimits: {},
      wipBlock: false,
      hideEmptyColumns: false,
      collapsedColumnKeys: [],
    });
  });

  it('rejeita chaves desconhecidas (schema estrito)', () => {
    expect(() => KanbanConfigSchema.parse({ columnsBy: 'group', bogus: true })).toThrow();
  });

  it('limita o WIP a inteiros positivos', () => {
    expect(() =>
      KanbanConfigSchema.parse({ columnsBy: 'group', wipLimits: { l1: 0 } }),
    ).toThrow();
    expect(KanbanConfigSchema.parse({ columnsBy: 'group', wipLimits: { l1: 5 } }).wipLimits).toEqual(
      { l1: 5 },
    );
  });
});

describe('parseViewConfig por tipo', () => {
  it('kanban e table aplicam seus próprios schemas; outros tipos aceitam forma livre', () => {
    expect(parseViewConfig('kanban', { columnsBy: 'c_status' })).toMatchObject({
      columnsBy: 'c_status',
    });
    expect(
      parseViewConfig('table', { columnWidths: { c_ust: 120 } } satisfies Record<
        string,
        unknown
      >),
    ).toEqual(TableConfigSchema.parse({ columnWidths: { c_ust: 120 } }));
    expect(parseViewConfig('calendar', { dateColumnKey: 'c_prazo' })).toEqual({
      dateColumnKey: 'c_prazo',
      defaultView: 'month',
    });
    expect(parseViewConfig('gantt', { startColumnKey: 'c_inicio', endColumnKey: 'c_fim' })).toEqual(
      {
        startColumnKey: 'c_inicio',
        endColumnKey: 'c_fim',
        groupBy: 'group',
        showCriticalPath: false,
        showWbs: true,
        baselineCompare: false,
        zoom: 'week',
      },
    );
    expect(parseViewConfig('form', { formId: '01a13ae4-0000-7000-8000-000000000001' })).toEqual({
      formId: '01a13ae4-0000-7000-8000-000000000001',
    });
    expect(parseViewConfig('dashboard', {})).toEqual({});
    expect(
      parseViewConfig('dashboard', { dashboardId: '01a13ae4-0000-7000-8000-000000000002' }),
    ).toEqual({ dashboardId: '01a13ae4-0000-7000-8000-000000000002' });
    expect(parseViewConfig('map', { bogus: true })).toEqual({ bogus: true });
  });
});

describe('tipos de view implementados', () => {
  it('inclui dashboard (ADR 0050)', () => {
    expect(IMPLEMENTED_VIEW_TYPES.has('dashboard')).toBe(true);
  });
});
