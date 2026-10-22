import { TimelineConfigSchema } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import { GROUP_A, GROUP_B, makeBoard } from '../../../test/board-fixtures';
import { makeItem } from '../../../test/fixtures';

import { timelineRows, timelineTasksOf } from './timeline-model';

const config = TimelineConfigSchema.parse({});
const LABELS = { none: 'Sem grupo', checked: 'Sim', unchecked: 'Não', person: (id: string) => id };

describe('timelineTasksOf', () => {
  it('ignora itens sem nenhuma das duas datas configuradas', () => {
    const items = [makeItem({ id: 'a', plannedStartDate: null, plannedEndDate: null })];
    expect(timelineTasksOf(items, config)).toHaveLength(0);
  });

  it('usa a data única como início e fim quando só uma ponta está preenchida', () => {
    const items = [makeItem({ id: 'a', plannedStartDate: '2026-03-10', plannedEndDate: null })];
    const tasks = timelineTasksOf(items, config);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ start: '2026-03-10', end: '2026-03-10' });
  });

  it('mantém início e fim quando ambos estão preenchidos', () => {
    const items = [
      makeItem({ id: 'a', plannedStartDate: '2026-03-10', plannedEndDate: '2026-03-15' }),
    ];
    const tasks = timelineTasksOf(items, config);
    expect(tasks[0]).toMatchObject({ start: '2026-03-10', end: '2026-03-15' });
  });
});

describe('timelineRows', () => {
  it('agrupa as tarefas pelos grupos do board (groupBy = "group")', () => {
    const board = makeBoard();
    const items = [
      makeItem({ id: 'a', groupId: GROUP_A, plannedStartDate: '2026-03-01', plannedEndDate: '2026-03-05' }),
      makeItem({ id: 'b', groupId: GROUP_B, plannedStartDate: '2026-03-02', plannedEndDate: '2026-03-06' }),
    ];
    const tasks = timelineTasksOf(items, config);
    const rows = timelineRows(board, tasks, 'group', LABELS);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.key === GROUP_A)?.tasks.map((task) => task.item.id)).toEqual(['a']);
    expect(rows.find((row) => row.key === GROUP_B)?.tasks.map((task) => task.item.id)).toEqual(['b']);
  });

  it('esconde buckets de coluna sem nenhuma tarefa datada (hideEmpty)', () => {
    const board = makeBoard();
    const items = [
      makeItem({
        id: 'a',
        values: { c_status: { labelId: '01a13ae4-0000-7000-8000-00000000a001' } },
        plannedStartDate: '2026-03-01',
        plannedEndDate: '2026-03-05',
      }),
    ];
    const tasks = timelineTasksOf(items, config);
    const rows = timelineRows(board, tasks, 'c_status', LABELS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tasks).toHaveLength(1);
  });
});
