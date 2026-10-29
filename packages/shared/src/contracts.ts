/**
 * Motor do módulo Contratos/OS/UST (ADR 0054): saldo de contrato, alertas (saldo baixo, vigência
 * próxima do fim, OS sem emissão), previsão de esgotamento de saldo e reconciliação de medição.
 * Puro e síncrono — sem I/O; a API busca os dados (contrato, ordens de serviço) e passa aqui para
 * calcular. Datas sempre strings ISO `YYYY-MM-DD` (data de negócio, sem fuso), mesma convenção de
 * `business-days.ts`/`portfolio.ts`.
 */
import { shiftDays } from './business-days.js';
import { daysBetween } from './timeline.js';

// ---------------------------------------------------------------------------
// Saldo de contrato
// ---------------------------------------------------------------------------

/**
 * Status de OS que já consomem saldo do contrato (ADR 0054): uma OS só "pesa" no saldo a partir do
 * aceite — `accepted`/`measured`/`invoiced` (o aceite é o critério de aceite do Prompt 13: "Saldo do
 * contrato atualizado automaticamente a cada OS aceita"). Antes disso (`draft`/`requested`/`issued`/
 * `in_progress`/`delivered`) a UST planejada da OS não é descontada — só reflete uma expectativa.
 * `cancelled` nunca consome.
 */
export const CONSUMING_ORDER_STATUSES = ['accepted', 'measured', 'invoiced'] as const;
export type ConsumingOrderStatus = (typeof CONSUMING_ORDER_STATUSES)[number];

export function isConsumingOrderStatus(status: string): status is ConsumingOrderStatus {
  return (CONSUMING_ORDER_STATUSES as readonly string[]).includes(status);
}

export interface ContractBalanceOrderInput {
  status: string;
  totalUst: number;
}

export interface ContractBalance {
  ustContracted: number;
  /** Soma da UST das OS em status consumidor (ver `CONSUMING_ORDER_STATUSES`). */
  ustConsumed: number;
  ustBalance: number;
  /** 0–100; `0` quando `ustContracted` é `0` (contrato sem UST contratada, caso-limite). */
  percentConsumed: number;
}

/**
 * Saldo do contrato: nunca armazenado — sempre calculado ao ler, a partir das OS atuais. Isso é o
 * que faz "saldo atualizado automaticamente" ser verdade por construção (sem motor de recálculo
 * assíncrono): a próxima leitura do contrato já reflete qualquer OS que acabou de ser aceita.
 */
export function computeContractBalance(
  ustContracted: number,
  orders: readonly ContractBalanceOrderInput[],
): ContractBalance {
  const ustConsumed = orders
    .filter((order) => isConsumingOrderStatus(order.status))
    .reduce((sum, order) => sum + order.totalUst, 0);
  const ustBalance = ustContracted - ustConsumed;
  const percentConsumed = ustContracted > 0 ? (ustConsumed / ustContracted) * 100 : 0;
  return { ustContracted, ustConsumed, ustBalance, percentConsumed };
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export const CONTRACT_ALERT_TYPES = ['low_balance', 'expiring', 'service_order_stalled'] as const;
export type ContractAlertType = (typeof CONTRACT_ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface ContractAlert {
  type: ContractAlertType;
  severity: AlertSeverity;
  message: string;
}

/** Saldo restante <= 15% do contratado → aviso; <= 7,5% (metade do limiar) → crítico. */
export const DEFAULT_LOW_BALANCE_THRESHOLD_PCT = 15;
/** Vigência termina em até 60 dias → aviso; em até 15 (um quarto do limiar) → crítico. */
export const DEFAULT_EXPIRING_WITHIN_DAYS = 60;
/** OS sem emissão 5 dias corridos após solicitada → aviso; 10 dias (2×) → crítico. */
export const DEFAULT_STALLED_AFTER_DAYS = 5;

/** `null` quando o saldo restante está acima do limiar (nada a alertar). */
export function evaluateLowBalance(
  balance: ContractBalance,
  thresholdPct: number = DEFAULT_LOW_BALANCE_THRESHOLD_PCT,
): ContractAlert | null {
  if (balance.ustContracted <= 0) return null;
  const percentRemaining = 100 - balance.percentConsumed;
  if (percentRemaining > thresholdPct) return null;
  return {
    type: 'low_balance',
    severity: percentRemaining <= thresholdPct / 2 ? 'critical' : 'warning',
    message: `Saldo de UST em ${percentRemaining.toFixed(1)}% do contratado (${balance.ustBalance.toFixed(2)} UST restantes).`,
  };
}

/** `null` quando a vigência já terminou (fora de escopo deste alerta) ou falta mais que `withinDays`. */
export function evaluateExpiring(
  endDate: string,
  today: string,
  withinDays: number = DEFAULT_EXPIRING_WITHIN_DAYS,
): ContractAlert | null {
  const remaining = daysBetween(today, endDate);
  if (remaining < 0 || remaining > withinDays) return null;
  return {
    type: 'expiring',
    severity: remaining <= Math.floor(withinDays / 4) ? 'critical' : 'warning',
    message: `Vigência do contrato termina em ${remaining} dia(s) (${endDate}).`,
  };
}

/** `null` quando a OS ainda não atingiu `afterDays` dias corridos desde a solicitação. */
export function evaluateStalledOrder(
  requestedAt: string,
  today: string,
  afterDays: number = DEFAULT_STALLED_AFTER_DAYS,
): ContractAlert | null {
  const elapsed = daysBetween(requestedAt, today);
  if (elapsed < afterDays) return null;
  return {
    type: 'service_order_stalled',
    severity: elapsed >= afterDays * 2 ? 'critical' : 'warning',
    message: `Solicitada há ${elapsed} dia(s) sem emissão.`,
  };
}

// ---------------------------------------------------------------------------
// Previsão de esgotamento de saldo
// ---------------------------------------------------------------------------

export interface ConsumptionPoint {
  /** Data em que a UST foi consumida (ex.: data em que a OS virou `accepted`). */
  date: string;
  consumedUst: number;
}

export interface ExhaustionForecast {
  /** UST consumida por dia corrido, em média, no histórico informado; `0` sem consumo suficiente. */
  dailyBurnRate: number;
  /**
   * `null` quando não há consumo (`dailyBurnRate` é `0`, projeção indefinida) ou o saldo já é
   * `<= 0` sem histórico para projetar quando isso ocorreu — nesses casos o chamador decide como
   * exibir ("sem dados" / "já esgotado").
   */
  estimatedExhaustionDate: string | null;
}

/**
 * Projeção linear simples (ADR 0054): taxa média de consumo no histórico informado, aplicada ao
 * saldo atual. Não é uma série temporal nem leva em conta sazonalidade — aproximação deliberada,
 * mesmo espírito de `plannedValueLinear` em `portfolio.ts`.
 */
export function forecastExhaustion(
  history: readonly ConsumptionPoint[],
  currentBalance: number,
  today: string,
): ExhaustionForecast {
  if (currentBalance <= 0) return { dailyBurnRate: 0, estimatedExhaustionDate: today };
  if (history.length === 0) return { dailyBurnRate: 0, estimatedExhaustionDate: null };
  const sorted = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return { dailyBurnRate: 0, estimatedExhaustionDate: null };
  const totalConsumed = sorted.reduce((sum, point) => sum + point.consumedUst, 0);
  const spanDays = Math.max(1, daysBetween(first.date, last.date));
  const dailyBurnRate = totalConsumed / spanDays;
  if (dailyBurnRate <= 0) return { dailyBurnRate: 0, estimatedExhaustionDate: null };
  const daysRemaining = Math.ceil(currentBalance / dailyBurnRate);
  return { dailyBurnRate, estimatedExhaustionDate: shiftDays(today, daysRemaining) };
}

// ---------------------------------------------------------------------------
// Reconciliação de medição
// ---------------------------------------------------------------------------

export interface MeasurementReconciliationInput {
  /** UST de cada OS (ou linha de OS) do período — a soma vira `measuredUst` por construção. */
  orderUstTotals: readonly number[];
  glosaUst: number;
}

export interface MeasurementReconciliation {
  measuredUst: number;
  /** `measuredUst - glosaUst`, nunca negativo. */
  approvedUst: number;
}

/**
 * `measuredUst` é sempre a soma real das OS do período (nunca digitado à mão) — é o que garante o
 * critério de aceite "relatório de medição mensal confere com a soma dos itens" por construção, não
 * por conferência manual depois do fato.
 */
export function reconcileMeasurement(input: MeasurementReconciliationInput): MeasurementReconciliation {
  const measuredUst = input.orderUstTotals.reduce((sum, value) => sum + value, 0);
  const approvedUst = Math.max(0, measuredUst - input.glosaUst);
  return { measuredUst, approvedUst };
}

// ---------------------------------------------------------------------------
// Linha de OS (serviço do catálogo × quantidade)
// ---------------------------------------------------------------------------

/** Mesma precisão do `check` de banco (`service_order_items_total`, 4 casas decimais). */
export function computeServiceOrderItemUst(quantity: number, ustUnit: number): number {
  return Math.round(quantity * ustUnit * 10_000) / 10_000;
}

/** Valor de faturamento de uma medição aprovada: `approvedUst × ustUnitPrice` do contrato. */
export function computeInvoiceAmount(approvedUst: number, ustUnitPrice: number): number {
  return Math.round(approvedUst * ustUnitPrice * 100) / 100;
}
