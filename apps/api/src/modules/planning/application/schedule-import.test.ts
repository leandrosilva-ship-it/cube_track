import { describe, expect, it } from 'vitest';

import { parseMspXml } from './schedule-import.service.js';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Project>
  <Tasks>
    <Task>
      <UID>0</UID>
      <Name>Projeto inteiro</Name>
      <Start>2026-01-01T08:00:00</Start>
      <Finish>2026-02-01T17:00:00</Finish>
      <Milestone>0</Milestone>
    </Task>
    <Task>
      <UID>1</UID>
      <Name>Levantamento de requisitos</Name>
      <Start>2026-01-05T08:00:00</Start>
      <Finish>2026-01-09T17:00:00</Finish>
      <Milestone>0</Milestone>
    </Task>
    <Task>
      <UID>2</UID>
      <Name>Desenvolvimento</Name>
      <Start>2026-01-12T08:00:00</Start>
      <Finish>2026-01-23T17:00:00</Finish>
      <Milestone>0</Milestone>
      <PredecessorLink>
        <PredecessorUID>1</PredecessorUID>
        <Type>1</Type>
        <LinkLag>0</LinkLag>
      </PredecessorLink>
    </Task>
    <Task>
      <UID>3</UID>
      <Name>Go-live</Name>
      <Start>2026-01-26T08:00:00</Start>
      <Finish>2026-01-26T08:00:00</Finish>
      <Milestone>1</Milestone>
      <PredecessorLink>
        <PredecessorUID>2</PredecessorUID>
        <Type>1</Type>
        <LinkLag>4800</LinkLag>
      </PredecessorLink>
      <PredecessorLink>
        <PredecessorUID>99</PredecessorUID>
        <Type>3</Type>
      </PredecessorLink>
    </Task>
  </Tasks>
</Project>`;

describe('parseMspXml (MSPDI)', () => {
  it('ignora a tarefa 0 (projeto inteiro) e lê nome/datas/marco', () => {
    const tasks = parseMspXml(SAMPLE_XML);
    expect(tasks.map((task) => task.uid)).toEqual(['1', '2', '3']);
    const requirements = tasks.find((task) => task.uid === '1');
    expect(requirements).toMatchObject({
      name: 'Levantamento de requisitos',
      start: '2026-01-05',
      finish: '2026-01-09',
      milestone: false,
    });
    const goLive = tasks.find((task) => task.uid === '3');
    expect(goLive?.milestone).toBe(true);
  });

  it('mapeia o tipo do vínculo (0=FF,1=FS,2=SF,3=SS) e converte o lag em dias', () => {
    const tasks = parseMspXml(SAMPLE_XML);
    const dev = tasks.find((task) => task.uid === '2');
    expect(dev?.predecessors).toEqual([{ predecessorUid: '1', type: 'FS', lagDays: 0 }]);

    const goLive = tasks.find((task) => task.uid === '3');
    // 4800 décimos de minuto / (8h * 60min * 10) = 1 dia útil de lag.
    expect(goLive?.predecessors).toContainEqual({ predecessorUid: '2', type: 'FS', lagDays: 1 });
    // Vínculo sem LinkLag informado vira 0, e o tipo 3 mapeia para SS.
    expect(goLive?.predecessors).toContainEqual({ predecessorUid: '99', type: 'SS', lagDays: 0 });
  });

  it('não quebra com um único <Task> ou <PredecessorLink> (sem array)', () => {
    const singleTask = parseMspXml(`<Project><Tasks><Task>
      <UID>1</UID><Name>Única tarefa</Name>
      <Start>2026-03-01T08:00:00</Start><Finish>2026-03-02T17:00:00</Finish>
      <Milestone>0</Milestone>
    </Task></Tasks></Project>`);
    expect(singleTask).toEqual([
      {
        uid: '1',
        name: 'Única tarefa',
        start: '2026-03-01',
        finish: '2026-03-02',
        milestone: false,
        predecessors: [],
      },
    ]);
  });

  it('tarefas sem data ficam com start/finish nulos em vez de quebrar', () => {
    const tasks = parseMspXml(
      `<Project><Tasks><Task><UID>5</UID><Name>Sem data</Name></Task></Tasks></Project>`,
    );
    expect(tasks).toEqual([
      { uid: '5', name: 'Sem data', start: null, finish: null, milestone: false, predecessors: [] },
    ]);
  });
});
