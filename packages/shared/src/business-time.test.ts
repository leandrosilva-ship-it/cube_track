import { describe, expect, it } from 'vitest';

import { addBusinessMinutes, type WorkHoursCalendar } from './business-time.js';

const CALENDAR: WorkHoursCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: new Set(['2026-03-05']),
  workStart: '09:00',
  workEnd: '18:00',
  timeZone: 'America/Sao_Paulo',
};

describe('addBusinessMinutes', () => {
  it('soma dentro do mesmo expediente', () => {
    // 2026-03-02 é segunda-feira; 10h local = 13h UTC (America/Sao_Paulo = UTC-3).
    const start = new Date('2026-03-02T13:00:00Z');
    const result = addBusinessMinutes(start, 60, CALENDAR);
    expect(result.toISOString()).toBe('2026-03-02T14:00:00.000Z'); // 11h local
  });

  it('transborda para o próximo dia útil quando passa do fim do expediente', () => {
    // 2026-03-02 17h local (20h UTC) + 120 min úteis: 1h restante hoje (até 18h) + 60 min amanhã.
    const start = new Date('2026-03-02T20:00:00Z');
    const result = addBusinessMinutes(start, 120, CALENDAR);
    // 2026-03-03 10h local = 13h UTC.
    expect(result.toISOString()).toBe('2026-03-03T13:00:00.000Z');
  });

  it('pula fim de semana e feriado', () => {
    // Sexta 2026-03-06, 17h local (quinta 05/03 é feriado) + 120 min → segunda 09/03.
    const start = new Date('2026-03-06T20:00:00Z'); // sexta 17h local
    const result = addBusinessMinutes(start, 120, CALENDAR);
    // sexta: 1h restante (até 18h) + 60 min na próxima segunda (09/03, pois sábado/domingo não contam)
    expect(result.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });

  it('se iniciado fora do expediente, conta a partir do próximo início', () => {
    // Sábado 2026-03-07 (fim de semana) → conta a partir de segunda 09/03 09h.
    const start = new Date('2026-03-07T12:00:00Z');
    const result = addBusinessMinutes(start, 30, CALENDAR);
    expect(result.toISOString()).toBe('2026-03-09T12:30:00.000Z'); // 09h30 local
  });
});
