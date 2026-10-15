import DecimalModule from 'decimal.js-light';
import type { Decimal as DecimalInstance } from 'decimal.js-light';

/**
 * Construtor decimal compartilhado (dinheiro, UST, agregações): nunca `float`.
 * O default import entrega o construtor no Node (CJS) e em bundlers (ESM); sob NodeNext a tipagem
 * o descreve como namespace do módulo.
 */
const BaseDecimal = DecimalModule as unknown as typeof DecimalModule.Decimal;

export const Decimal = BaseDecimal.clone({
  precision: 40,
  rounding: BaseDecimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});
export type Decimal = DecimalInstance;
