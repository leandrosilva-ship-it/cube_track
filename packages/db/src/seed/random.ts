/** Gerador pseudoaleatório determinístico (mulberry32) — o seed produz sempre os mesmos dados. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(values: readonly T[]): T {
    const value = values[Math.floor(this.next() * values.length)];
    if (value === undefined) throw new Error('pick() em lista vazia');
    return value;
  }

  digits(count: number): string {
    let result = '';
    for (let index = 0; index < count; index += 1) result += String(this.int(0, 9));
    return result;
  }
}

/** Soma dias a uma data ISO (`YYYY-MM-DD`). */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Soma dias úteis (seg–sex) a uma data ISO. */
export function addBusinessDays(date: string, days: number): string {
  let current = date;
  let remaining = days;
  while (remaining > 0) {
    current = addDays(current, 1);
    const weekday = new Date(`${current}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return current;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Converte data ISO + hora em instante (horário de Brasília, UTC−3). */
export function at(date: string, time = '10:00'): Date {
  return new Date(`${date}T${time}:00-03:00`);
}
