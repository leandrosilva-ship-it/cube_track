/**
 * Catálogo de funções das fórmulas: alimenta o autocompletar/ajuda do editor e a validação da
 * quantidade de argumentos no parser. Descrições ficam no i18n, indexadas pelo nome.
 */

export type FormulaFunctionCategory = 'logical' | 'math' | 'date' | 'text' | 'info';

export interface FormulaFunctionInfo {
  name: string;
  category: FormulaFunctionCategory;
  signature: string;
  minArgs: number;
  /** `null` = quantidade ilimitada. */
  maxArgs: number | null;
}

function fn(
  name: string,
  category: FormulaFunctionCategory,
  params: string,
  minArgs: number,
  maxArgs: number | null,
): FormulaFunctionInfo {
  return { name, category, signature: `${name}(${params})`, minArgs, maxArgs };
}

export const FORMULA_FUNCTIONS: readonly FormulaFunctionInfo[] = [
  fn('IF', 'logical', 'condição; se_verdadeiro; [se_falso]', 2, 3),
  fn('IFS', 'logical', 'condição1; valor1; [condição2; valor2; …]', 2, null),
  fn('SWITCH', 'logical', 'expressão; caso1; valor1; […]; [padrão]', 3, null),
  fn('AND', 'logical', 'lógico1; [lógico2; …]', 1, null),
  fn('OR', 'logical', 'lógico1; [lógico2; …]', 1, null),
  fn('NOT', 'logical', 'lógico', 1, 1),
  fn('XOR', 'logical', 'lógico1; [lógico2; …]', 1, null),
  fn('IFERROR', 'logical', 'valor; valor_se_erro', 2, 2),
  fn('SUM', 'math', 'número1; [número2; …]', 1, null),
  fn('AVERAGE', 'math', 'número1; [número2; …]', 1, null),
  fn('AVG', 'math', 'número1; [número2; …]', 1, null),
  fn('MIN', 'math', 'valor1; [valor2; …]', 1, null),
  fn('MAX', 'math', 'valor1; [valor2; …]', 1, null),
  fn('COUNT', 'math', 'valor1; [valor2; …]', 1, null),
  fn('COUNTA', 'math', 'valor1; [valor2; …]', 1, null),
  fn('ROUND', 'math', 'número; [casas_decimais]', 1, 2),
  fn('ROUNDUP', 'math', 'número; [casas_decimais]', 1, 2),
  fn('ROUNDDOWN', 'math', 'número; [casas_decimais]', 1, 2),
  fn('CEILING', 'math', 'número; [múltiplo]', 1, 2),
  fn('FLOOR', 'math', 'número; [múltiplo]', 1, 2),
  fn('ABS', 'math', 'número', 1, 1),
  fn('MOD', 'math', 'número; divisor', 2, 2),
  fn('POWER', 'math', 'base; expoente', 2, 2),
  fn('SQRT', 'math', 'número', 1, 1),
  fn('INT', 'math', 'número', 1, 1),
  fn('PERCENT', 'math', 'parte; total', 2, 2),
  fn('TODAY', 'date', '', 0, 0),
  fn('NOW', 'date', '', 0, 0),
  fn('DATE', 'date', 'ano; mês; dia', 3, 3),
  fn('YEAR', 'date', 'data', 1, 1),
  fn('MONTH', 'date', 'data', 1, 1),
  fn('DAY', 'date', 'data', 1, 1),
  fn('WEEKDAY', 'date', 'data', 1, 1),
  fn('WEEKNUM', 'date', 'data', 1, 1),
  fn('DAYS', 'date', 'data_final; data_inicial', 2, 2),
  fn('WORKDAYS', 'date', 'data_inicial; data_final', 2, 2),
  fn('ADD_DAYS', 'date', 'data; dias', 2, 2),
  fn('ADD_WORKDAYS', 'date', 'data; dias_úteis', 2, 2),
  fn('EDATE', 'date', 'data; meses', 2, 2),
  fn('EOMONTH', 'date', 'data; meses', 2, 2),
  fn('FORMAT_DATE', 'date', 'data; [formato]', 1, 2),
  fn('CONCAT', 'text', 'texto1; [texto2; …]', 1, null),
  fn('CONCATENATE', 'text', 'texto1; [texto2; …]', 1, null),
  fn('LEN', 'text', 'texto', 1, 1),
  fn('LEFT', 'text', 'texto; [quantidade]', 1, 2),
  fn('RIGHT', 'text', 'texto; [quantidade]', 1, 2),
  fn('MID', 'text', 'texto; início; quantidade', 3, 3),
  fn('UPPER', 'text', 'texto', 1, 1),
  fn('LOWER', 'text', 'texto', 1, 1),
  fn('TRIM', 'text', 'texto', 1, 1),
  fn('SUBSTITUTE', 'text', 'texto; antigo; novo', 3, 3),
  fn('REPLACE', 'text', 'texto; início; quantidade; novo', 4, 4),
  fn('SEARCH', 'text', 'procurar; texto', 2, 2),
  fn('CONTAINS', 'text', 'texto; procurar', 2, 2),
  fn('TEXT', 'text', 'valor; [casas_decimais]', 1, 2),
  fn('VALUE', 'text', 'texto', 1, 1),
  fn('REPT', 'text', 'texto; vezes', 2, 2),
  fn('ISERROR', 'info', 'valor', 1, 1),
  fn('ISBLANK', 'info', 'valor', 1, 1),
  fn('ISNUMBER', 'info', 'valor', 1, 1),
];

const BY_NAME = new Map(FORMULA_FUNCTIONS.map((info) => [info.name, info]));

/** Funções cujos argumentos vêm em pares (condição, valor). */
export const PAIRED_ARGUMENT_FUNCTIONS: ReadonlySet<string> = new Set(['IFS']);

export function findFormulaFunction(name: string): FormulaFunctionInfo | undefined {
  return BY_NAME.get(name.toUpperCase());
}
