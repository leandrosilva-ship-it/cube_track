import { describe, expect, it } from 'vitest';

import {
  aggregateRollup,
  applyWhatIfChanges,
  classifyEffortValue,
  computeEvm,
  computeWeightedScore,
  computeWsjf,
  defaultHealthRules,
  evaluateHealthRules,
  median,
  plannedValueLinear,
  summarizeWhatIf,
  worstHealth,
  wsjfInputFromScores,
} from './portfolio.js';

describe('worstHealth', () => {
  it('escolhe o pior status (red > yellow > green > grey)', () => {
    expect(worstHealth(['green', 'yellow', 'green'])).toBe('yellow');
    expect(worstHealth(['green', 'red', 'yellow'])).toBe('red');
    expect(worstHealth([])).toBe('grey');
  });
});

describe('evaluateHealthRules', () => {
  it('SPI < 0.9 vira amarelo (critério de aceite do Prompt 12)', () => {
    const result = evaluateHealthRules(defaultHealthRules(), { spi: 0.85, cpi: 1.1 });
    expect(result.schedule).toBe('yellow');
    expect(result.cost).toBe('green');
  });

  it('SPI < 0.8 vira vermelho', () => {
    const result = evaluateHealthRules(defaultHealthRules(), { spi: 0.7 });
    expect(result.schedule).toBe('red');
  });

  it('métrica ausente não casa nenhuma regra da dimensão (fica grey)', () => {
    const result = evaluateHealthRules(defaultHealthRules(), {});
    expect(result.schedule).toBe('grey');
  });

  it('overall sem regra própria é o pior-caso das demais dimensões', () => {
    const result = evaluateHealthRules(defaultHealthRules(), { spi: 0.7, cpi: 1.1, openCriticalRisks: 0 });
    expect(result.overall).toBe('red');
  });

  it('respeita a ordem do array: primeira regra que casar decide', () => {
    const result = evaluateHealthRules(
      [
        { dimension: 'risk', metric: 'open_critical_risks', operator: 'gte', threshold: 0, result: 'red' },
        { dimension: 'risk', metric: 'open_critical_risks', operator: 'gte', threshold: 1, result: 'green' },
      ],
      { openCriticalRisks: 2 },
    );
    expect(result.risk).toBe('red');
  });
});

describe('plannedValueLinear', () => {
  it('distribui o BAC linearmente ao longo do período', () => {
    const pv = plannedValueLinear({
      budgetAtCompletion: 1000,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-11',
      asOf: '2026-01-06',
    });
    expect(pv).toBe(500);
  });

  it('antes do início é 0; depois do fim é o total', () => {
    const options = { budgetAtCompletion: 1000, periodStart: '2026-01-01', periodEnd: '2026-01-11' };
    expect(plannedValueLinear({ ...options, asOf: '2025-12-01' })).toBe(0);
    expect(plannedValueLinear({ ...options, asOf: '2026-02-01' })).toBe(1000);
  });

  it('sem período definido, assume o total (sem como estimar progresso esperado)', () => {
    expect(
      plannedValueLinear({ budgetAtCompletion: 500, periodStart: null, periodEnd: null, asOf: '2026-01-01' }),
    ).toBe(500);
  });
});

describe('computeEvm', () => {
  it('calcula SPI/CPI/EAC/VAC a partir de PV/EV/AC', () => {
    const result = computeEvm({ budgetAtCompletion: 1000, percentComplete: 40, actualCost: 500, plannedValue: 500 });
    expect(result.ev).toBe(400);
    expect(result.spi).toBeCloseTo(0.8);
    expect(result.cpi).toBeCloseTo(0.8);
    expect(result.eac).toBeCloseTo(500 + (1000 - 400) / 0.8);
    expect(result.vac).toBeCloseTo(1000 - result.eac);
  });

  it('sem custo lançado, CPI é null e EAC cai para AC + restante sem projeção', () => {
    const result = computeEvm({ budgetAtCompletion: 1000, percentComplete: 20, actualCost: 0, plannedValue: 300 });
    expect(result.cpi).toBeNull();
    expect(result.eac).toBe(0 + (1000 - 200));
  });
});

describe('aggregateRollup', () => {
  it('soma custos/UST/riscos e usa o pior-caso de saúde entre os projetos', () => {
    const result = aggregateRollup([
      {
        boardId: 'b1',
        startDate: '2026-01-01',
        endDate: '2026-06-01',
        percentComplete: 50,
        overall: 'green',
        plannedCost: 1000,
        actualCost: 400,
        forecastCost: 900,
        ustTotal: 10,
        openRisks: 1,
        criticalRisks: 0,
      },
      {
        boardId: 'b2',
        startDate: '2026-03-01',
        endDate: '2026-12-01',
        percentComplete: 20,
        overall: 'red',
        plannedCost: 3000,
        actualCost: 1000,
        forecastCost: 3500,
        ustTotal: 5,
        openRisks: 2,
        criticalRisks: 1,
      },
    ]);
    expect(result.startDate).toBe('2026-01-01');
    expect(result.endDate).toBe('2026-12-01');
    expect(result.plannedCost).toBe(4000);
    expect(result.actualCost).toBe(1400);
    expect(result.ustTotal).toBe(15);
    expect(result.openRisks).toBe(3);
    expect(result.criticalRisks).toBe(1);
    expect(result.overall).toBe('red');
    // ponderado por custo planejado: (50*1000 + 20*3000) / 4000 = 27.5
    expect(result.percentComplete).toBeCloseTo(27.5);
  });

  it('lista vazia devolve um rollup neutro (grey, zeros)', () => {
    const result = aggregateRollup([]);
    expect(result.boardCount).toBe(0);
    expect(result.overall).toBe('grey');
  });
});

describe('computeWeightedScore', () => {
  it('normaliza por escala e sentido (higherIsBetter false inverte)', () => {
    const score = computeWeightedScore(
      [
        { key: 'valor', weight: 0.5, scaleMin: 1, scaleMax: 5, higherIsBetter: true },
        { key: 'risco', weight: 0.5, scaleMin: 1, scaleMax: 5, higherIsBetter: false },
      ],
      { valor: 5, risco: 1 },
    );
    // valor: (5-1)/4=1.0; risco invertido: (5-1)/4=1.0 → média ponderada 100
    expect(score).toBeCloseTo(100);
  });

  it('critério sem valor informado é ignorado (não derruba a média)', () => {
    const score = computeWeightedScore(
      [
        { key: 'a', weight: 1, scaleMin: 0, scaleMax: 10, higherIsBetter: true },
        { key: 'b', weight: 1, scaleMin: 0, scaleMax: 10, higherIsBetter: true },
      ],
      { a: 10 },
    );
    expect(score).toBeCloseTo(100);
  });
});

describe('WSJF', () => {
  it('computeWsjf = (valor + criticidade + risco) / tamanho', () => {
    expect(computeWsjf({ businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 4 })).toBe(4);
  });

  it('jobSize zero ou negativo devolve 0 (evita divisão por zero)', () => {
    expect(computeWsjf({ businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 0 })).toBe(0);
  });

  it('wsjfInputFromScores lê as 4 chaves por convenção, ou undefined se faltar alguma', () => {
    expect(
      wsjfInputFromScores({ business_value: 8, time_criticality: 5, risk_reduction: 3, job_size: 4 }),
    ).toEqual({ businessValue: 8, timeCriticality: 5, riskReduction: 3, jobSize: 4 });
    expect(wsjfInputFromScores({ business_value: 8 })).toBeUndefined();
  });
});

describe('median e classifyEffortValue', () => {
  it('median de array par e ímpar', () => {
    expect(median([1, 3, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('classifica os 4 quadrantes da matriz valor × esforço', () => {
    expect(classifyEffortValue({ value: 10, effort: 1 }, 5, 5)).toBe('quick_win');
    expect(classifyEffortValue({ value: 10, effort: 10 }, 5, 5)).toBe('major_project');
    expect(classifyEffortValue({ value: 1, effort: 1 }, 5, 5)).toBe('fill_in');
    expect(classifyEffortValue({ value: 1, effort: 10 }, 5, 5)).toBe('thankless_task');
  });
});

describe('what-if', () => {
  const baseline = [
    { boardId: 'a', active: true, plannedCost: 100, startDate: '2026-01-01', endDate: '2026-03-01' },
    { boardId: 'b', active: true, plannedCost: 200, startDate: '2026-01-01', endDate: '2026-06-01' },
  ];

  it('excluir um projeto remove seu custo do resumo do cenário', () => {
    const scenario = applyWhatIfChanges(baseline, [{ boardId: 'a', action: 'exclude' }]);
    const summary = summarizeWhatIf(scenario);
    expect(summary.activeProjects).toBe(1);
    expect(summary.totalPlannedCost).toBe(200);
  });

  it('adiar um projeto desloca suas datas sem afetar os demais', () => {
    const scenario = applyWhatIfChanges(baseline, [{ boardId: 'b', action: 'delay', delayDays: 30 }]);
    const shifted = scenario.find((p) => p.boardId === 'b');
    expect(shifted?.endDate).toBe('2026-07-01');
    expect(scenario.find((p) => p.boardId === 'a')?.endDate).toBe('2026-03-01');
  });

  it('resumo da baseline não é afetado pela aplicação do cenário (função pura)', () => {
    applyWhatIfChanges(baseline, [{ boardId: 'a', action: 'exclude' }]);
    expect(summarizeWhatIf(baseline).activeProjects).toBe(2);
  });
});
