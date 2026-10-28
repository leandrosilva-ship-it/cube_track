import { describe, expect, it } from 'vitest';

import { hoursToMinutes, minutesToHours, timeEntriesExportUrl } from './model';

describe('minutesToHours / hoursToMinutes', () => {
  it('converte minutos para horas com até duas casas decimais', () => {
    expect(minutesToHours(60)).toBe(1);
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(100)).toBe(1.67);
  });

  it('converte horas para minutos arredondando', () => {
    expect(hoursToMinutes(1)).toBe(60);
    expect(hoursToMinutes(1.5)).toBe(90);
    expect(hoursToMinutes(0.25)).toBe(15);
  });

  it('é uma conversão aproximadamente inversa', () => {
    expect(hoursToMinutes(minutesToHours(120))).toBe(120);
  });
});

describe('timeEntriesExportUrl', () => {
  it('monta a URL de exportação CSV com o período', () => {
    expect(timeEntriesExportUrl('user-1', '2024-01-01', '2024-01-07')).toBe(
      '/v1/users/user-1/time-entries/export.csv?from=2024-01-01&to=2024-01-07',
    );
  });
});
