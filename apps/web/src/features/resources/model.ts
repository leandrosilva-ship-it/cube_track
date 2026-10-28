import type { Allocation, AllocationStatus, CapacityBucket, CapacityHeatmapRow, Member, Skill } from '@/lib/api/types';

export type UtilizationLevel = 'idle' | 'normal' | 'high' | 'over';

/** Faixa de utilização de uma célula do heatmap: define a cor exibida (ADR 0052). */
export function utilizationLevel(bucket: Pick<CapacityBucket, 'utilization' | 'overallocated'>): UtilizationLevel {
  if (bucket.overallocated) return 'over';
  if (bucket.utilization === 0) return 'idle';
  if (bucket.utilization >= 0.85) return 'high';
  return 'normal';
}

export const UTILIZATION_CLASSES: Record<UtilizationLevel, string> = {
  idle: 'border-dashed border-border bg-surface-sunken text-fg-subtle',
  normal: 'border-transparent bg-success-soft text-success',
  high: 'border-transparent bg-warning-soft text-warning',
  over: 'border-danger bg-danger-soft text-danger',
};

export interface HeatmapGroup {
  key: string;
  label: string;
  rows: CapacityHeatmapRow[];
  /** Soma das colunas das linhas do grupo, na mesma ordem dos buckets. */
  totals: CapacityBucket[];
}

function sumBuckets(rows: readonly CapacityHeatmapRow[]): CapacityBucket[] {
  const first = rows[0];
  if (first === undefined) return [];
  return first.buckets.map((_, index) => {
    let nominalHours = 0;
    let availableHours = 0;
    let allocatedHours = 0;
    for (const row of rows) {
      const bucket = row.buckets[index];
      if (bucket === undefined) continue;
      nominalHours += bucket.nominalHours;
      availableHours += bucket.availableHours;
      allocatedHours += bucket.allocatedHours;
    }
    return {
      bucket: first.buckets[index]?.bucket ?? '',
      nominalHours,
      availableHours,
      allocatedHours,
      utilization: availableHours > 0 ? allocatedHours / availableHours : 0,
      overallocated: allocatedHours > availableHours,
    };
  });
}

/**
 * Agrupa as linhas do heatmap por pessoa, time ou skill (ADR 0052). Times/skills multivalorados
 * fazem a linha da pessoa aparecer em mais de um grupo (não há dupla contagem do total geral,
 * só dos subtotais de cada grupo).
 */
export function groupHeatmapRows(
  rows: readonly CapacityHeatmapRow[],
  groupBy: 'person' | 'team' | 'skill',
  teamNames: ReadonlyMap<string, string>,
  skillNames: ReadonlyMap<string, string>,
): HeatmapGroup[] {
  if (groupBy === 'person') {
    return rows
      .map((row) => ({ key: row.userId, label: row.userName, rows: [row], totals: row.buckets }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  const byKey = new Map<string, { label: string; rows: CapacityHeatmapRow[] }>();
  for (const row of rows) {
    const ids = groupBy === 'team' ? row.teamIds : row.skillIds;
    const names = groupBy === 'team' ? teamNames : skillNames;
    const keys = ids.length > 0 ? ids : ['__none__'];
    for (const id of keys) {
      const label = id === '__none__' ? '—' : (names.get(id) ?? id);
      const entry = byKey.get(id);
      if (entry === undefined) byKey.set(id, { label, rows: [row] });
      else entry.rows.push(row);
    }
  }
  return [...byKey.entries()]
    .map(([key, { label, rows: groupRows }]) => ({ key, label, rows: groupRows, totals: sumBuckets(groupRows) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function memberName(members: readonly Member[], userId: string): string {
  return members.find((member) => member.userId === userId)?.name ?? userId;
}

export function skillName(skills: readonly Skill[], skillId: string): string {
  return skills.find((skill) => skill.id === skillId)?.name ?? skillId;
}

/** Formata horas decimais (string) com até 2 casas, sem zeros à direita (ex.: "4", "7.5"). */
export function formatHours(value: string | number): string {
  const num = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (!Number.isFinite(num)) return '0';
  return Number(num.toFixed(2)).toString();
}

/** Lista de datas `YYYY-MM-DD` entre `from` e `to`, inclusive (sem fuso). */
export function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let [year = 0, month = 0, day = 0] = from.split('-').map(Number);
  const end = to;
  let current = from;
  while (current <= end) {
    dates.push(current);
    day += 1;
    const cursor = new Date(Date.UTC(year, month - 1, day));
    year = cursor.getUTCFullYear();
    month = cursor.getUTCMonth() + 1;
    day = cursor.getUTCDate();
    current = `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return dates;
}

/** Desloca uma data `YYYY-MM-DD` em `days` dias (pode ser negativo), sem fuso. */
export function shiftDate(date: string, days: number): string {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(cursor.getUTCFullYear())}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
}

/** Diferença em dias inteiros entre duas datas `YYYY-MM-DD` (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay = 0, am = 0, ad = 0] = a.split('-').map(Number);
  const [by = 0, bm = 0, bd = 0] = b.split('-').map(Number);
  const msPerDay = 86_400_000;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / msPerDay);
}

export const ABSENCE_TYPES = ['vacation', 'sick_leave', 'training', 'day_off', 'other'] as const;

export interface AllocationMovePlan {
  /** Ajusta o intervalo da alocação de origem para abrir espaço no dia movido (ou undefined se ela inteira muda de dono). */
  patchOriginal?: { id: string; startDate: string; endDate: string };
  /** A alocação de origem cobria só aquele dia: remove em vez de patchear. */
  removeOriginalId?: string;
  /** Quando o dia movido estava no MEIO do intervalo, o restante depois dele vira uma nova alocação. */
  extraCreates: { startDate: string; endDate: string; hoursPerDay: string }[];
  /** Nova alocação de 1 dia no destino, com as mesmas horas/board/item/status da origem. */
  targetCreate: { startDate: string; endDate: string; hoursPerDay: string };
}

/**
 * Plano de operações (PATCH/POST) para mover um dia inteiro de uma alocação para outra data
 * (ADR 0052): alocações são intervalos [startDate,endDate] com uma única `hoursPerDay`, não dias
 * avulsos, então mover um dia pode exigir dividir o intervalo em até três pedaços. Usado tanto pelo
 * drag-and-drop da Carga de trabalho quanto por "aplicar sugestão de nivelamento" — mesmo mecanismo,
 * para as duas não divergirem.
 */
export function planAllocationMove(
  allocation: Pick<Allocation, 'id' | 'startDate' | 'endDate' | 'hoursPerDay'>,
  fromDate: string,
  toDate: string,
): AllocationMovePlan {
  const { id, startDate, endDate, hoursPerDay } = allocation;
  const targetCreate = { startDate: toDate, endDate: toDate, hoursPerDay };
  if (startDate === endDate) {
    return { removeOriginalId: id, extraCreates: [], targetCreate };
  }
  if (fromDate === startDate) {
    return {
      patchOriginal: { id, startDate: shiftDate(fromDate, 1), endDate },
      extraCreates: [],
      targetCreate,
    };
  }
  if (fromDate === endDate) {
    return {
      patchOriginal: { id, startDate, endDate: shiftDate(fromDate, -1) },
      extraCreates: [],
      targetCreate,
    };
  }
  return {
    patchOriginal: { id, startDate, endDate: shiftDate(fromDate, -1) },
    extraCreates: [{ startDate: shiftDate(fromDate, 1), endDate, hoursPerDay }],
    targetCreate,
  };
}

export interface HeatmapCellId {
  userId: string;
  date: string;
}

const CELL_SEP = '::';

export function encodeCellId(userId: string, date: string): string {
  return `${userId}${CELL_SEP}${date}`;
}

export function decodeCellId(id: string): HeatmapCellId | null {
  const [userId, date] = id.split(CELL_SEP);
  if (userId === undefined || date === undefined) return null;
  return { userId, date };
}

/** Alocação que cobre `date` para `userId` (a mais recente, se houver mais de uma — raro). */
export function allocationOn(
  allocations: readonly Allocation[],
  userId: string,
  date: string,
): Allocation | undefined {
  return allocations.find(
    (allocation) => allocation.userId === userId && allocation.startDate <= date && date <= allocation.endDate,
  );
}

export const ALLOCATION_STATUSES: readonly AllocationStatus[] = ['tentative', 'confirmed'];
