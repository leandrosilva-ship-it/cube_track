import { describe, expect, it } from 'vitest';

import {
  computeContractBalance,
  computeInvoiceAmount,
  computeServiceOrderItemUst,
  evaluateExpiring,
  evaluateLowBalance,
  evaluateStalledOrder,
  forecastExhaustion,
  reconcileMeasurement,
} from './contracts.js';

describe('computeContractBalance', () => {
  it('só desconta OS em status consumidor (accepted/measured/invoiced)', () => {
    const balance = computeContractBalance(1000, [
      { status: 'draft', totalUst: 500 },
      { status: 'requested', totalUst: 50 },
      { status: 'issued', totalUst: 50 },
      { status: 'in_progress', totalUst: 50 },
      { status: 'delivered', totalUst: 50 },
      { status: 'accepted', totalUst: 100 },
      { status: 'measured', totalUst: 50 },
      { status: 'invoiced', totalUst: 30 },
      { status: 'cancelled', totalUst: 999 },
    ]);
    expect(balance.ustConsumed).toBe(180);
    expect(balance.ustBalance).toBe(820);
    expect(balance.percentConsumed).toBeCloseTo(18, 5);
  });

  it('contrato sem UST contratada: percentConsumed é 0, não divide por zero', () => {
    const balance = computeContractBalance(0, [{ status: 'accepted', totalUst: 10 }]);
    expect(balance.percentConsumed).toBe(0);
    expect(balance.ustBalance).toBe(-10);
  });

  it('sem nenhuma OS: saldo total disponível', () => {
    const balance = computeContractBalance(500, []);
    expect(balance.ustConsumed).toBe(0);
    expect(balance.ustBalance).toBe(500);
  });
});

describe('evaluateLowBalance', () => {
  it('acima do limiar: sem alerta', () => {
    const balance = computeContractBalance(1000, [{ status: 'accepted', totalUst: 500 }]); // 50% restante
    expect(evaluateLowBalance(balance)).toBeNull();
  });

  it('dentro do limiar mas acima da metade: aviso', () => {
    const balance = computeContractBalance(1000, [{ status: 'accepted', totalUst: 880 }]); // 12% restante
    const alert = evaluateLowBalance(balance);
    expect(alert?.severity).toBe('warning');
  });

  it('abaixo da metade do limiar: crítico', () => {
    const balance = computeContractBalance(1000, [{ status: 'accepted', totalUst: 950 }]); // 5% restante
    const alert = evaluateLowBalance(balance);
    expect(alert?.severity).toBe('critical');
  });

  it('contrato sem UST contratada: nunca alerta (caso-limite sem base de comparação)', () => {
    const balance = computeContractBalance(0, []);
    expect(evaluateLowBalance(balance)).toBeNull();
  });
});

describe('evaluateExpiring', () => {
  it('fora da janela: sem alerta', () => {
    expect(evaluateExpiring('2026-12-31', '2026-01-01')).toBeNull();
  });

  it('vigência já terminada: sem alerta (fora de escopo deste alerta)', () => {
    expect(evaluateExpiring('2025-12-31', '2026-01-01')).toBeNull();
  });

  it('dentro da janela mas longe do limite: aviso', () => {
    const alert = evaluateExpiring('2026-02-01', '2026-01-01', 60);
    expect(alert?.severity).toBe('warning');
  });

  it('bem perto do fim: crítico', () => {
    const alert = evaluateExpiring('2026-01-05', '2026-01-01', 60);
    expect(alert?.severity).toBe('critical');
  });
});

describe('evaluateStalledOrder', () => {
  it('ainda dentro do prazo: sem alerta', () => {
    expect(evaluateStalledOrder('2026-01-01', '2026-01-03', 5)).toBeNull();
  });

  it('passou do prazo: aviso', () => {
    const alert = evaluateStalledOrder('2026-01-01', '2026-01-07', 5);
    expect(alert?.severity).toBe('warning');
  });

  it('bem além do prazo (2x): crítico', () => {
    const alert = evaluateStalledOrder('2026-01-01', '2026-01-15', 5);
    expect(alert?.severity).toBe('critical');
  });
});

describe('forecastExhaustion', () => {
  it('saldo já esgotado: data de hoje, sem precisar de histórico', () => {
    const forecast = forecastExhaustion([], 0, '2026-01-10');
    expect(forecast.estimatedExhaustionDate).toBe('2026-01-10');
  });

  it('sem histórico e saldo positivo: sem projeção', () => {
    const forecast = forecastExhaustion([], 100, '2026-01-10');
    expect(forecast.dailyBurnRate).toBe(0);
    expect(forecast.estimatedExhaustionDate).toBeNull();
  });

  it('consumo constante: projeta a data proporcional ao saldo restante', () => {
    // 100 UST consumidas em 10 dias = 10 UST/dia; saldo 50 → esgota em 5 dias.
    const forecast = forecastExhaustion(
      [
        { date: '2026-01-01', consumedUst: 50 },
        { date: '2026-01-11', consumedUst: 50 },
      ],
      50,
      '2026-01-11',
    );
    expect(forecast.dailyBurnRate).toBeCloseTo(10, 5);
    expect(forecast.estimatedExhaustionDate).toBe('2026-01-16');
  });

  it('ordem dos pontos não importa (ordena internamente)', () => {
    const forecastA = forecastExhaustion(
      [
        { date: '2026-01-11', consumedUst: 50 },
        { date: '2026-01-01', consumedUst: 50 },
      ],
      50,
      '2026-01-11',
    );
    expect(forecastA.dailyBurnRate).toBeCloseTo(10, 5);
  });
});

describe('reconcileMeasurement', () => {
  it('measuredUst é a soma real das OS do período; approvedUst desconta a glosa', () => {
    const result = reconcileMeasurement({ orderUstTotals: [40, 60, 20], glosaUst: 15 });
    expect(result.measuredUst).toBe(120);
    expect(result.approvedUst).toBe(105);
  });

  it('glosa nunca deixa approvedUst negativo', () => {
    const result = reconcileMeasurement({ orderUstTotals: [10], glosaUst: 50 });
    expect(result.approvedUst).toBe(0);
  });

  it('sem OS no período: tudo zero', () => {
    const result = reconcileMeasurement({ orderUstTotals: [], glosaUst: 0 });
    expect(result.measuredUst).toBe(0);
    expect(result.approvedUst).toBe(0);
  });
});

describe('computeServiceOrderItemUst / computeInvoiceAmount', () => {
  it('arredonda em 4 casas decimais (mesma precisão do check de banco)', () => {
    expect(computeServiceOrderItemUst(3, 40)).toBe(120);
    expect(computeServiceOrderItemUst(2, 33.33335)).toBeCloseTo(66.6667, 4);
  });

  it('valor de fatura em 2 casas decimais (moeda)', () => {
    expect(computeInvoiceAmount(100, 148.5)).toBe(14850);
    expect(computeInvoiceAmount(33.335, 10)).toBeCloseTo(333.35, 2);
  });
});
