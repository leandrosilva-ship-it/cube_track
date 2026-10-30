import { describe, expect, it } from 'vitest';

import type { Contract, Invoice, Measurement } from '@/lib/api/types';

import {
  alertTone,
  allowedInvoiceTransitions,
  canInvoiceMeasurement,
  contractStatusTone,
  hasActiveInvoice,
  hasCriticalAlert,
  invoiceStatusTone,
  isMeasurementEditable,
  measurementStatusTone,
  remainingBalancePercent,
  totalAlertCount,
} from './model';

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'c1',
    workspaceId: 'w1',
    number: '001/2026',
    title: 'Sustentação de sistemas',
    clientName: 'Prefeitura Municipal',
    clientDocument: null,
    object: null,
    seiProcess: null,
    biddingReference: null,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    ustUnitPrice: '150.00',
    ustContracted: '1000',
    totalValue: '150000.00',
    status: 'active',
    managerId: null,
    notes: null,
    balance: { ustContracted: 1000, ustConsumed: 0, ustBalance: 1000, percentConsumed: 0 },
    alerts: [],
    stalledOrders: [],
    ...overrides,
  };
}

function measurement(overrides: Partial<Measurement> = {}): Measurement {
  return {
    id: 'm1',
    contractId: 'c1',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    measuredUst: '100',
    glosaUst: '0',
    approvedUst: null,
    amount: null,
    status: 'draft',
    approvedBy: null,
    approvedAt: null,
    notes: null,
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    contractId: 'c1',
    measurementId: 'm1',
    number: 'NF-001',
    issueDate: '2026-02-01',
    dueDate: null,
    amount: '15000.00',
    status: 'issued',
    paidAt: null,
    nfeKey: null,
    ...overrides,
  };
}

describe('alertTone', () => {
  it('mapeia severidade warning para o tom warning', () => {
    expect(alertTone('warning')).toBe('warning');
  });
  it('mapeia severidade critical para o tom danger', () => {
    expect(alertTone('critical')).toBe('danger');
  });
});

describe('tons de status', () => {
  it('contractStatusTone: ativo é success, suspenso é warning, encerrado é neutral', () => {
    expect(contractStatusTone('active')).toBe('success');
    expect(contractStatusTone('suspended')).toBe('warning');
    expect(contractStatusTone('closed')).toBe('neutral');
    expect(contractStatusTone('draft')).toBe('neutral');
  });

  it('measurementStatusTone: aprovada é success, rejeitada é danger', () => {
    expect(measurementStatusTone('approved')).toBe('success');
    expect(measurementStatusTone('rejected')).toBe('danger');
    expect(measurementStatusTone('submitted')).toBe('warning');
    expect(measurementStatusTone('draft')).toBe('neutral');
  });

  it('invoiceStatusTone: paga é success, cancelada é danger', () => {
    expect(invoiceStatusTone('paid')).toBe('success');
    expect(invoiceStatusTone('cancelled')).toBe('danger');
    expect(invoiceStatusTone('issued')).toBe('warning');
    expect(invoiceStatusTone('draft')).toBe('neutral');
  });
});

describe('isMeasurementEditable', () => {
  it('permite editar/decidir medição em rascunho ou enviada', () => {
    expect(isMeasurementEditable('draft')).toBe(true);
    expect(isMeasurementEditable('submitted')).toBe(true);
  });
  it('não permite editar medição já decidida', () => {
    expect(isMeasurementEditable('approved')).toBe(false);
    expect(isMeasurementEditable('rejected')).toBe(false);
  });
});

describe('canInvoiceMeasurement', () => {
  it('permite faturar uma medição aprovada com valor calculado', () => {
    expect(canInvoiceMeasurement(measurement({ status: 'approved', approvedUst: '100', amount: '15000.00' }))).toBe(
      true,
    );
  });
  it('não permite faturar medição não aprovada', () => {
    expect(canInvoiceMeasurement(measurement({ status: 'submitted' }))).toBe(false);
  });
  it('não permite faturar medição aprovada sem valor (caso-limite)', () => {
    expect(canInvoiceMeasurement(measurement({ status: 'approved', amount: null }))).toBe(false);
  });
});

describe('allowedInvoiceTransitions', () => {
  it('de rascunho: pode emitir ou cancelar', () => {
    expect(allowedInvoiceTransitions('draft')).toEqual(['issued', 'cancelled']);
  });
  it('de emitida: pode pagar ou cancelar', () => {
    expect(allowedInvoiceTransitions('issued')).toEqual(['paid', 'cancelled']);
  });
  it('paga e cancelada são terminais', () => {
    expect(allowedInvoiceTransitions('paid')).toEqual([]);
    expect(allowedInvoiceTransitions('cancelled')).toEqual([]);
  });
});

describe('remainingBalancePercent', () => {
  it('calcula o percentual restante a partir do percentual consumido', () => {
    const c = contract({ balance: { ustContracted: 1000, ustConsumed: 300, ustBalance: 700, percentConsumed: 30 } });
    expect(remainingBalancePercent(c)).toBe(70);
  });
  it('retorna 0 quando o contrato não tem UST contratada (caso-limite)', () => {
    const c = contract({ balance: { ustContracted: 0, ustConsumed: 0, ustBalance: 0, percentConsumed: 0 } });
    expect(remainingBalancePercent(c)).toBe(0);
  });
  it('nunca fica negativo mesmo com consumo acima de 100%', () => {
    const c = contract({ balance: { ustContracted: 100, ustConsumed: 150, ustBalance: -50, percentConsumed: 150 } });
    expect(remainingBalancePercent(c)).toBe(0);
  });
});

describe('contagem e severidade de alertas', () => {
  it('totalAlertCount soma alertas e OS paradas', () => {
    const c = contract({
      alerts: [{ type: 'low_balance', severity: 'warning', message: 'x' }],
      stalledOrders: [{ serviceOrderId: 'os1', number: 'OS-1', alert: { type: 'service_order_stalled', severity: 'critical', message: 'y' } }],
    });
    expect(totalAlertCount(c)).toBe(2);
  });

  it('hasCriticalAlert identifica alerta crítico em `alerts`', () => {
    const c = contract({ alerts: [{ type: 'expiring', severity: 'critical', message: 'x' }] });
    expect(hasCriticalAlert(c)).toBe(true);
  });

  it('hasCriticalAlert identifica alerta crítico em `stalledOrders`', () => {
    const c = contract({
      stalledOrders: [{ serviceOrderId: 'os1', number: 'OS-1', alert: { type: 'service_order_stalled', severity: 'critical', message: 'y' } }],
    });
    expect(hasCriticalAlert(c)).toBe(true);
  });

  it('hasCriticalAlert é falso quando só há alertas de warning', () => {
    const c = contract({ alerts: [{ type: 'low_balance', severity: 'warning', message: 'x' }] });
    expect(hasCriticalAlert(c)).toBe(false);
  });
});

describe('hasActiveInvoice', () => {
  it('é true quando a medição já tem fatura emitida', () => {
    expect(hasActiveInvoice('m1', [invoice({ status: 'issued' })])).toBe(true);
  });
  it('é true quando a medição já tem fatura paga', () => {
    expect(hasActiveInvoice('m1', [invoice({ status: 'paid' })])).toBe(true);
  });
  it('é false quando a única fatura foi cancelada', () => {
    expect(hasActiveInvoice('m1', [invoice({ status: 'cancelled' })])).toBe(false);
  });
  it('é false sem nenhuma fatura para a medição', () => {
    expect(hasActiveInvoice('m2', [invoice({ measurementId: 'm1', status: 'issued' })])).toBe(false);
  });
});
