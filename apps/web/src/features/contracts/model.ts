import type {
  Contract,
  Invoice,
  InvoiceStatus,
  Measurement,
  MeasurementStatus,
  ServiceOrderStatus,
} from '@/lib/api/types';

/**
 * Funções puras do módulo Contratos/OS/UST (ADR 0054) — sem I/O, fáceis de testar isoladamente.
 * Os dados em si (saldo, alertas, medições) já vêm prontos do backend; aqui só decidimos como
 * apresentá-los (tom de badge, opções de formulário).
 */

export const CONTRACT_STATUSES: readonly Contract['status'][] = ['draft', 'active', 'suspended', 'closed'];
export const MEASUREMENT_DECISION_STATUSES: readonly MeasurementStatus[] = ['draft', 'submitted'];
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'issued', 'paid', 'cancelled'];

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** Tom do `Badge` para a severidade de um alerta de contrato (ADR 0054). */
export function alertTone(severity: 'warning' | 'critical'): BadgeTone {
  return severity === 'critical' ? 'danger' : 'warning';
}

export function contractStatusTone(status: Contract['status']): BadgeTone {
  switch (status) {
    case 'active':
      return 'success';
    case 'suspended':
      return 'warning';
    case 'closed':
      return 'neutral';
    case 'draft':
      return 'neutral';
  }
}

export function measurementStatusTone(status: MeasurementStatus): BadgeTone {
  switch (status) {
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'submitted':
      return 'warning';
    case 'draft':
      return 'neutral';
  }
}

export function invoiceStatusTone(status: InvoiceStatus): BadgeTone {
  switch (status) {
    case 'paid':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'issued':
      return 'warning';
    case 'draft':
      return 'neutral';
  }
}

/** Uma medição só pode ser editada ou decidida enquanto não foi aprovada/rejeitada. */
export function isMeasurementEditable(status: MeasurementStatus): boolean {
  return MEASUREMENT_DECISION_STATUSES.includes(status);
}

/** Só pode gerar fatura de uma medição aprovada (mesma regra do backend, só para não oferecer a ação à toa). */
export function canInvoiceMeasurement(measurement: Measurement): boolean {
  return measurement.status === 'approved' && measurement.amount !== null;
}

/** Transições de status de fatura permitidas a partir do status atual (espelha `InvoicesService.transition`). */
export function allowedInvoiceTransitions(status: InvoiceStatus): Exclude<InvoiceStatus, 'draft'>[] {
  switch (status) {
    case 'draft':
      return ['issued', 'cancelled'];
    case 'issued':
      return ['paid', 'cancelled'];
    case 'paid':
    case 'cancelled':
      return [];
  }
}

/** Percentual do saldo restante (0–100), usado na barra de progresso do saldo do contrato. */
export function remainingBalancePercent(contract: Contract): number {
  if (contract.balance.ustContracted <= 0) return 0;
  return Math.max(0, Math.min(100, 100 - contract.balance.percentConsumed));
}

/** Total de alertas (saldo baixo, vigência e OS paradas) de um contrato — usado no card da listagem. */
export function totalAlertCount(contract: Contract): number {
  return contract.alerts.length + contract.stalledOrders.length;
}

/** `true` quando algum alerta do contrato é crítico — decide a cor do indicador no card da listagem. */
export function hasCriticalAlert(contract: Contract): boolean {
  return (
    contract.alerts.some((alert) => alert.severity === 'critical') ||
    contract.stalledOrders.some((stalled) => stalled.alert.severity === 'critical')
  );
}

/** Já existe uma fatura ativa (emitida ou paga) para esta medição? Evita oferecer "Faturar" à toa. */
export function hasActiveInvoice(measurementId: string, invoices: readonly Invoice[]): boolean {
  return invoices.some(
    (invoice) =>
      invoice.measurementId === measurementId && (invoice.status === 'issued' || invoice.status === 'paid'),
  );
}

// -------------------------------------------------------------------- ordens de serviço (OS) ---

export const SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = [
  'draft',
  'requested',
  'issued',
  'in_progress',
  'delivered',
  'accepted',
  'measured',
  'invoiced',
  'cancelled',
];

/**
 * Sequência linear da OS (ADR 0054) — espelha `TRANSITION_SEQUENCE` de
 * `apps/api/.../service-orders.service.ts`. `cancelled` não faz parte da sequência: é tratado à
 * parte em `isValidServiceOrderTransition`.
 */
const SERVICE_ORDER_SEQUENCE: readonly Exclude<ServiceOrderStatus, 'cancelled'>[] = [
  'draft',
  'requested',
  'issued',
  'in_progress',
  'delivered',
  'accepted',
  'measured',
  'invoiced',
];

/**
 * Espelha exatamente `isValidTransition` do backend (`ServiceOrdersService`): sequência linear
 * draft→…→invoiced, mais `cancelled` alcançável de qualquer status não-terminal (menos `invoiced`,
 * e não de `cancelled` para `cancelled`). Mantida aqui só para decidir quais ações oferecer na UI —
 * a validação de verdade é sempre refeita pelo backend.
 */
function isValidServiceOrderTransition(from: ServiceOrderStatus, to: ServiceOrderStatus): boolean {
  if (to === 'cancelled') return from !== 'invoiced' && from !== 'cancelled';
  if (from === 'cancelled' || from === 'invoiced') return false;
  const fromIndex = SERVICE_ORDER_SEQUENCE.indexOf(from);
  const toIndex = SERVICE_ORDER_SEQUENCE.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return false;
  return toIndex === fromIndex + 1;
}

/** `draft` nunca é destino de transição (é sempre o status inicial) — só origem. */
const SERVICE_ORDER_TRANSITION_TARGETS: readonly Exclude<ServiceOrderStatus, 'draft'>[] = [
  'requested',
  'issued',
  'in_progress',
  'delivered',
  'accepted',
  'measured',
  'invoiced',
  'cancelled',
];

/** Status de destino que a OS pode assumir a partir do status atual (botões de transição na UI). */
export function allowedServiceOrderTransitions(
  status: ServiceOrderStatus,
): Exclude<ServiceOrderStatus, 'draft'>[] {
  return SERVICE_ORDER_TRANSITION_TARGETS.filter((candidate) => isValidServiceOrderTransition(status, candidate));
}

export function serviceOrderStatusTone(status: ServiceOrderStatus): BadgeTone {
  switch (status) {
    case 'accepted':
    case 'measured':
    case 'invoiced':
      return 'success';
    case 'cancelled':
      return 'danger';
    case 'in_progress':
    case 'delivered':
      return 'info';
    case 'requested':
    case 'issued':
      return 'warning';
    case 'draft':
      return 'neutral';
  }
}

/**
 * Uma UST/unidade informada manualmente (diferente do `defaultUst` do catálogo) exige justificativa
 * — mesma regra de `resolveUstUnit` em `ServiceOrderItemsService` (backend). Um valor em branco ainda
 * não é considerado divergente (o usuário pode estar no meio da digitação).
 */
export function requiresOverrideReason(ustUnit: string, catalogDefaultUst: string): boolean {
  if (ustUnit.trim() === '') return false;
  return Number(ustUnit) !== Number(catalogDefaultUst);
}
