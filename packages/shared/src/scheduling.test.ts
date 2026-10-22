import { describe, expect, it } from 'vitest';

import {
  addBusinessDays,
  alignToBusinessDay,
  businessDaysBetween,
  DEFAULT_CALENDAR,
} from './business-days.js';
import { computeCriticalPath, computeSchedule } from './scheduling.js';

const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: new Set(['2026-11-02', '2026-11-20']) };

describe('dias úteis', () => {
  it('pula fins de semana e feriados', () => {
    expect(addBusinessDays('2026-10-30', 1, calendar)).toBe('2026-11-03');
    expect(addBusinessDays('2026-11-03', -1, calendar)).toBe('2026-10-30');
    expect(addBusinessDays('2026-10-31', 0, calendar)).toBe('2026-11-03');
    expect(alignToBusinessDay('2026-11-01', DEFAULT_CALENDAR, -1)).toBe('2026-10-30');
  });

  it('conta dias úteis inclusive', () => {
    expect(businessDaysBetween('2026-11-02', '2026-11-06', calendar)).toBe(4);
    expect(businessDaysBetween('2026-11-06', '2026-11-02', calendar)).toBe(0);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => addBusinessDays('03/11/2026', 1, calendar)).toThrow(RangeError);
    expect(() => addBusinessDays('2026-11-03', 1.5, calendar)).toThrow(RangeError);
    expect(() =>
      addBusinessDays('2026-11-03', 1, { workingDays: [], holidays: new Set() }),
    ).toThrow(RangeError);
  });
});

describe('computeSchedule', () => {
  it('FS empurra o sucessor preservando a duração', () => {
    const result = computeSchedule(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-10' },
        { id: 'b', start: '2026-11-05', end: '2026-11-06' },
      ],
      [{ predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 }],
      calendar,
    );
    expect(result.changes).toEqual([
      {
        id: 'b',
        start: '2026-11-11',
        end: '2026-11-12',
        previousStart: '2026-11-05',
        previousEnd: '2026-11-06',
      },
    ]);
  });

  it('aplica lag e propaga em cadeia', () => {
    const result = computeSchedule(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-04' },
        { id: 'b', start: '2026-11-03', end: '2026-11-03' },
        { id: 'c', start: '2026-11-03', end: '2026-11-03' },
      ],
      [
        { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 2 },
        { predecessorId: 'b', successorId: 'c', type: 'SS', lagDays: 1 },
      ],
      calendar,
    );
    expect(result.changes.map((change) => [change.id, change.start, change.end])).toEqual([
      ['b', '2026-11-09', '2026-11-09'],
      ['c', '2026-11-10', '2026-11-10'],
    ]);
  });

  it('FF e SF ajustam pelo término', () => {
    const ff = computeSchedule(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-13' },
        { id: 'b', start: '2026-11-03', end: '2026-11-05' },
      ],
      [{ predecessorId: 'a', successorId: 'b', type: 'FF', lagDays: 0 }],
      calendar,
    );
    expect(ff.changes[0]).toMatchObject({ id: 'b', start: '2026-11-11', end: '2026-11-13' });
    const sf = computeSchedule(
      [
        { id: 'a', start: '2026-11-16', end: '2026-11-18' },
        { id: 'b', start: '2026-11-03', end: '2026-11-04' },
      ],
      [{ predecessorId: 'a', successorId: 'b', type: 'SF', lagDays: 0 }],
      calendar,
    );
    expect(sf.changes[0]).toMatchObject({ id: 'b', start: '2026-11-13', end: '2026-11-16' });
  });

  it('não puxa tarefas planejadas mais tarde', () => {
    const result = computeSchedule(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-04' },
        { id: 'b', start: '2026-12-01', end: '2026-12-02' },
      ],
      [{ predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 }],
      calendar,
    );
    expect(result.changes).toEqual([]);
  });

  it('detecta ciclos sem alterá-los e ignora tarefas sem datas', () => {
    const result = computeSchedule(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-04' },
        { id: 'b', start: '2026-11-03', end: '2026-11-04' },
        { id: 'c', start: null, end: null },
      ],
      [
        { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 },
        { predecessorId: 'b', successorId: 'a', type: 'FS', lagDays: 0 },
        { predecessorId: 'c', successorId: 'a', type: 'FS', lagDays: 0 },
      ],
      calendar,
    );
    expect(result.cyclic.sort()).toEqual(['a', 'b']);
    expect(result.changes).toEqual([]);
  });
});

describe('computeCriticalPath', () => {
  it('cadeia sem folga é toda crítica; ramo paralelo mais curto tem folga positiva', () => {
    const result = computeCriticalPath(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-04' },
        { id: 'b', start: '2026-11-05', end: '2026-11-06' },
        { id: 'c', start: '2026-11-09', end: '2026-11-10' },
        { id: 'd', start: '2026-11-03', end: '2026-11-04' },
      ],
      [
        { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 },
        { predecessorId: 'b', successorId: 'c', type: 'FS', lagDays: 0 },
      ],
      calendar,
    );
    const byId = new Map(result.tasks.map((task) => [task.id, task]));
    expect(byId.get('a')).toMatchObject({ lateStart: '2026-11-03', lateFinish: '2026-11-04', totalFloatDays: 0, isCritical: true });
    expect(byId.get('b')).toMatchObject({ lateStart: '2026-11-05', lateFinish: '2026-11-06', totalFloatDays: 0, isCritical: true });
    expect(byId.get('c')).toMatchObject({ lateStart: '2026-11-09', lateFinish: '2026-11-10', totalFloatDays: 0, isCritical: true });
    expect(byId.get('d')).toMatchObject({ lateStart: '2026-11-09', lateFinish: '2026-11-10', totalFloatDays: 4, isCritical: false });
    expect(result.cyclic).toEqual([]);
  });

  it('predecessor fora do prazo (sucessor já agendado antes do que o vínculo permitiria) fica com folga negativa', () => {
    const result = computeCriticalPath(
      [
        { id: 'a', start: '2026-11-09', end: '2026-11-10' },
        { id: 'b', start: '2026-11-03', end: '2026-11-04' },
      ],
      [{ predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 }],
      calendar,
    );
    const a = result.tasks.find((task) => task.id === 'a');
    expect(a?.totalFloatDays).toBeLessThan(0);
    expect(a?.isCritical).toBe(true);
  });

  it('ignora tarefas em ciclo e sem datas', () => {
    const result = computeCriticalPath(
      [
        { id: 'a', start: '2026-11-03', end: '2026-11-04' },
        { id: 'b', start: '2026-11-03', end: '2026-11-04' },
        { id: 'c', start: null, end: null },
      ],
      [
        { predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 0 },
        { predecessorId: 'b', successorId: 'a', type: 'FS', lagDays: 0 },
      ],
      calendar,
    );
    expect(result.cyclic.sort()).toEqual(['a', 'b']);
    expect(result.tasks).toEqual([]);
  });
});
