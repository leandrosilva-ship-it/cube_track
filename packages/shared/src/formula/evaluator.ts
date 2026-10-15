import type { FormulaAst } from './ast.js';
import { FormulaSyntaxError } from './ast.js';
import type { FormulaContext, FunctionScope } from './context.js';
import { findFunctionImplementation } from './functions.js';
import { applyBinary, negate, percent } from './operators.js';
import { parseFormula } from './parser.js';
import {
  booleanValue,
  formulaError,
  isError,
  numberValue,
  parseDecimal,
  textValue,
  toResult,
  unwrap,
} from './values.js';
import type { FormulaResult, Value } from './values.js';

function evaluateNode(node: FormulaAst, scope: FunctionScope): Value {
  switch (node.type) {
    case 'number': {
      const value = parseDecimal(node.value);
      return value === null
        ? formulaError('#VALUE!', `Número inválido ${node.value}`)
        : numberValue(value);
    }
    case 'text':
      return textValue(node.value);
    case 'boolean':
      return booleanValue(node.value);
    case 'reference': {
      const value = scope.context.resolve(node.name);
      return value ?? formulaError('#REF!', `Coluna {${node.name}} não encontrada`);
    }
    case 'unary': {
      const operand = scope.evaluate(node.operand);
      // `+` unário não converte o valor, como no Excel.
      return node.operator === '-' ? negate(operand) : unwrap(operand);
    }
    case 'percent':
      return percent(scope.evaluate(node.operand));
    case 'binary': {
      const left = scope.evaluate(node.left);
      if (isError(left)) return left;
      return applyBinary(node.operator, left, scope.evaluate(node.right));
    }
    case 'call': {
      const implementation = findFunctionImplementation(node.name);
      if (!implementation) return formulaError('#NAME?', `Função desconhecida: ${node.name}`);
      return implementation(node.args, scope);
    }
  }
}

/** Avalia a árvore. Falhas inesperadas de cálculo (ex.: estouro decimal) viram `#NUM!` no nó. */
export function evaluateFormula(ast: FormulaAst, context: FormulaContext): FormulaResult {
  const scope: FunctionScope = {
    context,
    evaluate: (node) => {
      try {
        return evaluateNode(node, scope);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return formulaError('#NUM!', `Falha no cálculo: ${detail}`);
      }
    },
  };
  return toResult(scope.evaluate(ast));
}

/** Analisa e avalia; erros de sintaxe viram `#ERROR!`. */
export function computeFormula(expression: string, context: FormulaContext): FormulaResult {
  let ast: FormulaAst;
  try {
    ast = parseFormula(expression);
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return formulaError('#ERROR!', error.message);
    throw error;
  }
  return evaluateFormula(ast, context);
}
