import { describe, expect, it } from 'vitest';

import type { Contract, Invoice, Measurement } from '@/lib/api/types';

import {
  alertTone,
  allowedInvoiceTransitions,
  allowedServiceOrderTransitions,
  canInvoiceMeasurement,
  contractStatusTone,
  hasActiveInvoice,
  hasCriticalAlert,
  invoiceStatusTone,
  isMeasurementEditable,
  measurementStatusTone,
  remainingBalancePercent,
  requiresOverrideReason,
  serviceOrderStatusTone,
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

describe('serviceOrderStatusTone', () => {
  it('aceita/medida/faturada são success', () => {
    expect(serviceOrderStatusTone('accepted')).toBe('success');
    expect(serviceOrderStatusTone('measured')).toBe('success');
    expect(serviceOrderStatusTone('invoiced')).toBe('success');
  });
  it('cancelada é danger', () => {
    expect(serviceOrderStatusTone('cancelled')).toBe('danger');
  });
  it('em execução/entregue são info', () => {
    expect(serviceOrderStatusTone('in_progress')).toBe('info');
    expect(serviceOrderStatusTone('delivered')).toBe('info');
  });
  it('solicitada/emitida são warning', () => {
    expect(serviceOrderStatusTone('requested')).toBe('warning');
    expect(serviceOrderStatusTone('issued')).toBe('warning');
  });
  it('rascunho é neutral', () => {
    expect(serviceOrderStatusTone('draft')).toBe('neutral');
  });
});

describe('allowedServiceOrderTransitions', () => {
  it('espelha a sequência linear do backend: rascunho pode solicitar ou cancelar', () => {
    expect(allowedServiceOrderTransitions('draft')).toEqual(['requested', 'cancelled']);
  });
  it('cada etapa intermediária só avança um passo na sequência, além de poder cancelar', () => {
    expect(allowedServiceOrderTransitions('requested')).toEqual(['issued', 'cancelled']);
    expect(allowedServiceOrderTransitions('issued')).toEqual(['in_progress', 'cancelled']);
    expect(allowedServiceOrderTransitions('in_progress')).toEqual(['delivered', 'cancelled']);
    expect(allowedServiceOrderTransitions('delivered')).toEqual(['accepted', 'cancelled']);
    expect(allowedServiceOrderTransitions('accepted')).toEqual(['measured', 'cancelled']);
    expect(allowedServiceOrderTransitions('measured')).toEqual(['invoiced', 'cancelled']);
  });
  it('faturada é terminal — não pode nem ser cancelada', () => {
    expect(allowedServiceOrderTransitions('invoiced')).toEqual([]);
  });
  it('cancelada é terminal', () => {
    expect(allowedServiceOrderTransitions('cancelled')).toEqual([]);
  });
});

describe('requiresOverrideReason', () => {
  it('não exige justificativa quando a UST informada é igual ao padrão do catálogo', () => {
    expect(requiresOverrideReason('40', '40')).toBe(false);
    expect(requiresOverrideReason('40.0000', '40')).toBe(false);
  });
  it('exige justificativa quando a UST informada diverge do padrão do catálogo', () => {
    expect(requiresOverrideReason('35', '40')).toBe(true);
  });
  it('não exige justificativa enquanto o campo está vazio (usuário ainda digitando)', () => {
    expect(requiresOverrideReason('', '40')).toBe(false);
  });
});
