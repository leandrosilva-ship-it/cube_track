/**
 * Cálculo de capacidade/alocação (ADR 0052): disponível × alocado por pessoa e por dia, a partir de
 * `WorkingCalendar` (ADR 0019) + jornada (`hoursPerDay`) + ausências. Datas são sempre strings ISO
 * `YYYY-MM-DD` (datas de negócio, sem fuso) — mesma convenção de `business-days.ts`.
 */
import { isBusinessDay, isoWeekday, shiftDays, type WorkingCalendar } from './business-days.js';

export interface AbsencePeriod {
  startDate: string;
  endDate: string;
  /** `null` = dia inteiro; caso contrário, horas de ausência naquele dia (ausência parcial). */
  hoursPerDay: number | null;
}

export interface AllocationPeriod {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
}

export interface CapacityDay {
  date: string;
  /** Capacidade nominal do dia (jornada), antes de ausências — 0 em dia não útil. */
  nominalHours: number;
  /** Capacidade após ausências — nunca negativa. */
  availableHours: number;
  allocatedHours: number;
  /** `allocatedHours / availableHours`; `0` quando `availableHours` é `0` e não há alocação. */
  utilization: number;
  overallocated: boolean;
  idle: boolean;
}

/** Segunda-feira ISO da semana de `date` (semana começa na segunda — mesma convenção do timesheet). */
export function isoWeekStart(date: string): string {
  return shiftDays(date, -(isoWeekday(date) - 1));
}

/** Todas as datas ISO de `from` a `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let current = from; current <= to; current = shiftDays(current, 1)) dates.push(current);
  return dates;
}

function overlaps(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

/** Horas de ausência num dia específico (soma, caso haja mais de uma ausência parcial no mesmo dia). */
function absenceHoursOn(date: string, absences: readonly AbsencePeriod[], nominalHours: number): number {
  let hours = 0;
  for (const absence of absences) {
    if (!overlaps(date, absence.startDate, absence.endDate)) continue;
    hours += absence.hoursPerDay ?? nominalHours;
  }
  return hours;
}

/**
 * Capacidade/alocação dia a dia de uma pessoa no intervalo `[from, to]`. `allocations` deve já vir
 * filtrada para o `userId` em questão (o chamador cruza com múltiplas pessoas uma vez só).
 */
export function dailyCapacity(options: {
  from: string;
  to: string;
  calendar: WorkingCalendar;
  hoursPerDay: number;
  absences: readonly AbsencePeriod[];
  allocations: readonly Pick<AllocationPeriod, 'startDate' | 'endDate' | 'hoursPerDay'>[];
}): CapacityDay[] {
  const { from, to, calendar, hoursPerDay, absences, allocations } = options;
  return dateRange(from, to).map((date) => {
    const nominalHours = isBusinessDay(date, calendar) ? hoursPerDay : 0;
    const availableHours = Math.max(0, nominalHours - absenceHoursOn(date, absences, hoursPerDay));
    const allocatedHours = allocations
      .filter((allocation) => overlaps(date, allocation.startDate, allocation.endDate))
      .reduce((sum, allocation) => sum + allocation.hoursPerDay, 0);
    const utilization = availableHours > 0 ? allocatedHours / availableHours : allocatedHours > 0 ? Infinity : 0;
    return {
      date,
      nominalHours,
      availableHours,
      allocatedHours,
      utilization,
      overallocated: allocatedHours > availableHours + 1e-9,
      idle: availableHours > 0 && allocatedHours === 0,
    };
  });
}

export interface LevelingSuggestion {
  userId: string;
  allocationId: string;
  /** Dia sobrealocado de onde a sugestão tira horas. */
  fromDate: string;
  /** Dia com folga para onde a sugestão move as horas. */
  toDate: string;
  hours: number;
}

/**
 * Sugestão gulosa de nivelamento (ADR 0052): para cada dia sobrealocado, tenta mover o excedente da
 * alocação mais recente (a mais fácil de adiar) para o primeiro dia com folga suficiente dentro da
 * janela `[from, to]` — não é um solver ótimo, só uma sugestão de ponto de partida que a pessoa
 * revisa antes de aplicar (vira uma edição normal de alocação, não uma mutação própria).
 */
export function suggestLeveling(options: {
  from: string;
  to: string;
  days: readonly CapacityDay[];
  allocations: readonly AllocationPeriod[];
}): LevelingSuggestion[] {
  const { days, allocations } = options;
  const dayByDate = new Map(days.map((day) => [day.date, day]));
  const suggestions: LevelingSuggestion[] = [];
  const slack = new Map(days.map((day) => [day.date, Math.max(0, day.availableHours - day.allocatedHours)]));

  for (const day of days) {
    if (!day.overallocated) continue;
    let excess = day.allocatedHours - day.availableHours;
    const candidates = allocations
      .filter((allocation) => day.date >= allocation.startDate && day.date <= allocation.endDate)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)); // a mais recente primeiro (mais fácil de adiar)

    for (const allocation of candidates) {
      if (excess <= 1e-9) break;
      const target = days.find(
        (candidate) =>
          candidate.date > day.date && (slack.get(candidate.date) ?? 0) > 1e-9,
      );
      if (target === undefined) continue;
      const available = slack.get(target.date) ?? 0;
      const moved = Math.min(excess, allocation.hoursPerDay, available);
      if (moved <= 1e-9) continue;
      suggestions.push({
        userId: allocation.userId,
        allocationId: allocation.id,
        fromDate: day.date,
        toDate: target.date,
        hours: moved,
      });
      excess -= moved;
      slack.set(target.date, available - moved);
    }
  }
  return suggestions.filter((suggestion) => dayByDate.has(suggestion.fromDate));
}

export interface ForecastBucket {
  /** Início do mês (`YYYY-MM-01`). */
  month: string;
  capacityHours: number;
  demandHours: number;
  gapHours: number;
}

/** Primeiro dia do mês seguinte, em ISO. */
function nextMonthStart(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (m ?? 1) - 1 + 1, 1));
  return date.toISOString().slice(0, 10);
}

/** `months` baldes mensais a partir do mês de `from` (inclusive), para a previsão de 3/6/12 meses. */
export function monthlyBuckets(from: string, months: number): { month: string; start: string; end: string }[] {
  const buckets: { month: string; start: string; end: string }[] = [];
  let start = `${from.slice(0, 7)}-01`;
  for (let i = 0; i < months; i += 1) {
    const end = shiftDays(nextMonthStart(start), -1);
    buckets.push({ month: start, start, end });
    start = nextMonthStart(start);
  }
  return buckets;
}
