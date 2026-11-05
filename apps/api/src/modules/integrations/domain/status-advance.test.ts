import { describe, expect, it } from 'vitest';

import { pickStatusAdvance, type StatusColumnCandidate } from './status-advance.js';

function column(overrides: Partial<StatusColumnCandidate> = {}): StatusColumnCandidate {
  return {
    columnKey: 'c_status',
    currentLabelId: 'l_doing',
    labels: [
      { id: 'l_todo', label: 'A fazer', category: 'not_started' },
      { id: 'l_doing', label: 'Em andamento', category: 'in_progress' },
      { id: 'l_done', label: 'Concluído', category: 'done' },
    ],
    ...overrides,
  };
}

describe('pickStatusAdvance', () => {
  it('avança para o único rótulo de categoria "done" quando o item ainda não está nele', () => {
    expect(pickStatusAdvance([column()])).toEqual({ columnKey: 'c_status', labelId: 'l_done' });
  });

  it('não avança quando o item já está no rótulo "done"', () => {
    expect(pickStatusAdvance([column({ currentLabelId: 'l_done' })])).toBeNull();
  });

  it('cai para o nome do rótulo quando nenhum tem categoria "done" (heurística conservadora)', () => {
    const withoutCategory = column({
      labels: [
        { id: 'l_todo', label: 'A fazer', category: 'not_started' },
        { id: 'l_doing', label: 'Em andamento', category: 'in_progress' },
        { id: 'l_stuck', label: 'Bloqueado', category: 'stuck' },
        { id: 'l_finished', label: 'Finalizado', category: 'not_started' },
      ],
    });
    expect(pickStatusAdvance([withoutCategory])).toEqual({ columnKey: 'c_status', labelId: 'l_finished' });
  });

  it('não avança quando há mais de um rótulo "done" (ambíguo)', () => {
    const ambiguous = column({
      labels: [
        { id: 'l_todo', label: 'A fazer', category: 'not_started' },
        { id: 'l_doing', label: 'Em andamento', category: 'in_progress' },
        { id: 'l_done1', label: 'Concluído', category: 'done' },
        { id: 'l_done2', label: 'Finalizado', category: 'done' },
      ],
    });
    expect(pickStatusAdvance([ambiguous])).toBeNull();
  });

  it('não avança quando nenhum rótulo parece "concluído"', () => {
    const noMatch = column({
      labels: [
        { id: 'l_todo', label: 'A fazer', category: 'not_started' },
        { id: 'l_doing', label: 'Em andamento', category: 'in_progress' },
        { id: 'l_stuck', label: 'Bloqueado', category: 'stuck' },
      ],
    });
    expect(pickStatusAdvance([noMatch])).toBeNull();
  });

  it('ignora uma coluna binária (Sim/Não) mesmo com um rótulo "done" — não é um workflow de verdade', () => {
    const toggle = column({
      columnKey: 'c_os_solicitada',
      currentLabelId: 'l_nao',
      labels: [
        { id: 'l_sim', label: 'Sim', category: 'done' },
        { id: 'l_nao', label: 'Não', category: 'not_started' },
      ],
    });
    const realStatus = column({ columnKey: 'c_status' });
    expect(pickStatusAdvance([toggle, realStatus])).toEqual({ columnKey: 'c_status', labelId: 'l_done' });
    expect(pickStatusAdvance([toggle])).toBeNull();
  });

  it('usa a primeira coluna de status elegível quando há várias', () => {
    const noMatch = column({
      columnKey: 'c_status_a',
      labels: [
        { id: 'l_todo', label: 'A fazer', category: 'not_started' },
        { id: 'l_doing', label: 'Em andamento', category: 'in_progress' },
        { id: 'l_stuck', label: 'Bloqueado', category: 'stuck' },
      ],
    });
    const eligible = column({ columnKey: 'c_status_b' });
    expect(pickStatusAdvance([noMatch, eligible])).toEqual({ columnKey: 'c_status_b', labelId: 'l_done' });
  });
});
