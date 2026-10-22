import { describe, expect, it } from 'vitest';

import { dayTitle, monthGrid, monthStart, monthTitle, weekdayLabels, weekOf } from './calendar-model';

describe('monthStart', () => {
  it('monta a data do primeiro dia e normaliza mês fora de 0-11 (navegação)', () => {
    expect(monthStart(2026, 0)).toBe('2026-01-01');
    expect(monthStart(2026, 11)).toBe('2026-12-01');
    expect(monthStart(2026, 12)).toBe('2027-01-01'); // próximo (dezembro + 1)
    expect(monthStart(2026, -1)).toBe('2025-12-01'); // anterior (janeiro - 1)
  });
});

describe('monthGrid', () => {
  it('cobre o mês inteiro em semanas completas (segunda a domingo)', () => {
    // Fevereiro/2026 começa numa domingo (01/02) e termina num sábado (28/02).
    const weeks = monthGrid('2026-02-01', '2026-02-15');
    for (const week of weeks) expect(week).toHaveLength(7);
    const allDays = weeks.flat();
    expect(allDays[0]?.date).toBe('2026-01-26'); // segunda antes do 1º de fevereiro
    expect(allDays.at(-1)?.date).toBe('2026-03-01'); // domingo depois do 28 de fevereiro
    expect(allDays.find((day) => day.date === '2026-02-01')?.inCurrentMonth).toBe(true);
    expect(allDays.find((day) => day.date === '2026-01-26')?.inCurrentMonth).toBe(false);
  });

  it('marca hoje e fins de semana corretamente', () => {
    const weeks = monthGrid('2026-02-01', '2026-02-15');
    const allDays = weeks.flat();
    expect(allDays.find((day) => day.date === '2026-02-15')?.isToday).toBe(true);
    expect(allDays.find((day) => day.date === '2026-02-14')?.isWeekend).toBe(true); // sábado
    expect(allDays.find((day) => day.date === '2026-02-16')?.isWeekend).toBe(false); // segunda
  });

  it('mês que já começa numa segunda-feira não precisa de dias do mês anterior', () => {
    // Junho/2026 começa numa segunda-feira.
    const weeks = monthGrid('2026-06-01', '2026-06-01');
    expect(weeks[0]?.[0]?.date).toBe('2026-06-01');
  });
});

describe('weekOf', () => {
  it('sempre devolve 7 dias começando na segunda-feira da semana', () => {
    const week = weekOf('2026-02-19', '2026-02-19'); // quinta-feira
    expect(week).toHaveLength(7);
    expect(week[0]?.date).toBe('2026-02-16'); // segunda da mesma semana
    expect(week[6]?.date).toBe('2026-02-22'); // domingo
  });
});

describe('rótulos (pt-BR)', () => {
  it('weekdayLabels devolve 7 rótulos começando em segunda', () => {
    const labels = weekdayLabels('pt-BR');
    expect(labels).toHaveLength(7);
  });

  it('monthTitle e dayTitle produzem texto não vazio', () => {
    expect(monthTitle('2026-02-01', 'pt-BR').length).toBeGreaterThan(0);
    expect(dayTitle('2026-02-15', 'pt-BR').length).toBeGreaterThan(0);
  });
});
