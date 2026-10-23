import { describe, expect, it } from 'vitest';

import { CreateProjectHealthSchema } from './project-health.js';

describe('CreateProjectHealthSchema', () => {
  it('exige overall e aplica grey nas demais dimensões', () => {
    const parsed = CreateProjectHealthSchema.parse({ overall: 'green' });
    expect(parsed).toEqual({
      overall: 'green',
      schedule: 'grey',
      cost: 'grey',
      scope: 'grey',
      quality: 'grey',
      risk: 'grey',
    });
  });

  it('rejeita percentComplete fora de 0–100', () => {
    expect(CreateProjectHealthSchema.safeParse({ overall: 'red', percentComplete: 120 }).success).toBe(
      false,
    );
  });

  it('aceita spi/cpi e resumo', () => {
    const parsed = CreateProjectHealthSchema.parse({
      overall: 'yellow',
      spi: 0.92,
      cpi: 1.05,
      summary: 'Atraso na frente de integração.',
    });
    expect(parsed.spi).toBe(0.92);
    expect(parsed.cpi).toBe(1.05);
  });
});
