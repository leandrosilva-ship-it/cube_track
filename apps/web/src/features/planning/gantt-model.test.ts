import { describe, expect, it } from 'vitest';

import { dateToX } from '@cube-track/shared';
import type { CriticalPathEntry, GanttDependency, GanttTask } from '@/lib/api/types';

import { dependencyConnectors, ganttRows, wbsCompare, wbsDepth } from './gantt-model';

function makeTask(overrides: Partial<GanttTask> & Pick<GanttTask, 'id'>): GanttTask {
  return {
    parentItemId: null,
    groupId: 'g1',
    name: 'Tarefa',
    wbs: null,
    position: 'a0',
    plannedStartDate: null,
    plannedEndDate: null,
    replannedStartDate: null,
    replannedEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    start: null,
    end: null,
    progress: null,
    isMilestone: false,
    scheduleMode: 'auto',
    ...overrides,
  };
}

describe('wbsCompare', () => {
  it('ordena numericamente por segmento, não como texto ("1.2" antes de "1.10")', () => {
    const codes = ['1.10', '1.2', '1.1', '2.1'];
    expect([...codes].sort(wbsCompare)).toEqual(['1.1', '1.2', '1.10', '2.1']);
  });

  it('manda códigos ausentes (null) para o final', () => {
    expect(wbsCompare(null, '1.1')).toBeGreaterThan(0);
    expect(wbsCompare('1.1', null)).toBeLessThan(0);
  });
});

describe('wbsDepth', () => {
  it('item de topo (2 segmentos) tem profundidade 0; cada subnível soma 1', () => {
    expect(wbsDepth('1.2')).toBe(0);
    expect(wbsDepth('1.2.1')).toBe(1);
    expect(wbsDepth('1.2.1.3')).toBe(2);
    expect(wbsDepth(null)).toBe(0);
  });
});

describe('ganttRows', () => {
  const groups = [
    { id: 'g1', name: 'Grupo 1', color: '#579bfc' },
    { id: 'g2', name: 'Grupo 2', color: '#a25ddc' },
  ];

  it('insere uma linha de cabeçalho a cada troca de grupo, na ordem WBS', () => {
    const tasks = [
      makeTask({ id: 'b', groupId: 'g2', wbs: '2.1' }),
      makeTask({ id: 'a', groupId: 'g1', wbs: '1.1' }),
      makeTask({ id: 'a2', groupId: 'g1', wbs: '1.2' }),
    ];
    const rows = ganttRows(tasks, groups, true);
    expect(rows.map((row) => row.key)).toEqual([
      'group:g1',
      'a',
      'a2',
      'group:g2',
      'b',
    ]);
    expect(rows[0]).toMatchObject({ type: 'group', groupName: 'Grupo 1' });
  });

  it('sem showGroups, só retorna as linhas de tarefa ordenadas', () => {
    const tasks = [
      makeTask({ id: 'b', groupId: 'g2', wbs: '2.1' }),
      makeTask({ id: 'a', groupId: 'g1', wbs: '1.1' }),
    ];
    const rows = ganttRows(tasks, groups, false);
    expect(rows.every((row) => row.type === 'task')).toBe(true);
    expect(rows.map((row) => row.key)).toEqual(['a', 'b']);
  });

  it('indenta subitens pela profundidade do WBS', () => {
    const tasks = [
      makeTask({ id: 'parent', wbs: '1.1' }),
      makeTask({ id: 'child', wbs: '1.1.1' }),
    ];
    const rows = ganttRows(tasks, groups, false);
    expect(rows.find((row) => row.key === 'parent')?.depth).toBe(0);
    expect(rows.find((row) => row.key === 'child')?.depth).toBe(1);
  });
});

describe('dependencyConnectors', () => {
  const PX_PER_DAY = 10;
  const ROW_HEIGHT = 40;

  it('conecta fim do predecessor ao início do sucessor (FS)', () => {
    const predecessor = makeTask({ id: 'p', start: '2026-03-01', end: '2026-03-05' });
    const successor = makeTask({ id: 's', start: '2026-03-06', end: '2026-03-10' });
    const dependencies: GanttDependency[] = [
      { id: 'd1', predecessorId: 'p', successorId: 's', type: 'FS', lagDays: 0 },
    ];
    const tasksById = new Map([
      ['p', predecessor],
      ['s', successor],
    ]);
    const rowIndexById = new Map([
      ['p', 0],
      ['s', 1],
    ]);
    const connectors = dependencyConnectors(
      dependencies,
      tasksById,
      rowIndexById,
      [],
      '2026-03-01',
      PX_PER_DAY,
      ROW_HEIGHT,
      dateToX,
    );
    expect(connectors).toHaveLength(1);
    const expectedFromX = dateToX('2026-03-05', '2026-03-01', PX_PER_DAY) + PX_PER_DAY;
    const expectedToX = dateToX('2026-03-06', '2026-03-01', PX_PER_DAY);
    expect(connectors[0]?.path).toContain(`M ${String(expectedFromX)} 20`);
    expect(connectors[0]?.path).toContain(String(expectedToX));
  });

  it('marca como crítica só quando predecessor E sucessor estão no caminho crítico', () => {
    const predecessor = makeTask({ id: 'p', start: '2026-03-01', end: '2026-03-05' });
    const successor = makeTask({ id: 's', start: '2026-03-06', end: '2026-03-10' });
    const dependencies: GanttDependency[] = [
      { id: 'd1', predecessorId: 'p', successorId: 's', type: 'FS', lagDays: 0 },
    ];
    const tasksById = new Map([
      ['p', predecessor],
      ['s', successor],
    ]);
    const rowIndexById = new Map([
      ['p', 0],
      ['s', 1],
    ]);
    const criticalPath: CriticalPathEntry[] = [
      { id: 'p', earlyStart: '2026-03-01', earlyFinish: '2026-03-05', lateStart: '2026-03-01', lateFinish: '2026-03-05', totalFloatDays: 0, isCritical: true },
      { id: 's', earlyStart: '2026-03-06', earlyFinish: '2026-03-10', lateStart: '2026-03-07', lateFinish: '2026-03-11', totalFloatDays: 1, isCritical: false },
    ];
    const connectors = dependencyConnectors(
      dependencies,
      tasksById,
      rowIndexById,
      criticalPath,
      '2026-03-01',
      PX_PER_DAY,
      ROW_HEIGHT,
      dateToX,
    );
    expect(connectors[0]?.critical).toBe(false);
  });

  it('ignora dependências com tarefa sem data ou fora das linhas visíveis', () => {
    const predecessor = makeTask({ id: 'p', start: null, end: null });
    const successor = makeTask({ id: 's', start: '2026-03-06', end: '2026-03-10' });
    const dependencies: GanttDependency[] = [
      { id: 'd1', predecessorId: 'p', successorId: 's', type: 'FS', lagDays: 0 },
    ];
    const connectors = dependencyConnectors(
      dependencies,
      new Map([['p', predecessor], ['s', successor]]),
      new Map([['p', 0], ['s', 1]]),
      [],
      '2026-03-01',
      PX_PER_DAY,
      ROW_HEIGHT,
      dateToX,
    );
    expect(connectors).toHaveLength(0);
  });
});
