import type { WorkingCalendar } from '../business-days.js';
import type { FormulaAst } from './ast.js';
import type { FormulaValue, Value } from './values.js';

export interface FormulaContext {
  /** Valor de uma coluna referenciada; `undefined` quando a referência não existe (=> `#REF!`). */
  resolve: (reference: string) => FormulaValue | undefined;
  /** Data de hoje (`YYYY-MM-DD`) no fuso do tenant. */
  today: string;
  /** Instante atual em ISO 8601. */
  now: string;
  calendar: WorkingCalendar;
}

/** Escopo entregue às funções: avaliam seus argumentos sob demanda (permite IF/IFERROR preguiçosos). */
export interface FunctionScope {
  evaluate: (node: FormulaAst) => Value;
  context: FormulaContext;
}

export type FormulaFunction = (args: readonly FormulaAst[], scope: FunctionScope) => Value;
