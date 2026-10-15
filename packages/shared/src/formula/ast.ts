/**
 * Árvore sintática das fórmulas (objetos simples, serializáveis em JSON).
 * `position` é o deslocamento (em caracteres) do início do nó na expressão original.
 */

export type FormulaBinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '&'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>=';

export interface FormulaNumberNode {
  type: 'number';
  /** Decimal canônico (ex.: `"1000"` para `1e3`). */
  value: string;
  position: number;
}

export interface FormulaTextNode {
  type: 'text';
  value: string;
  position: number;
}

export interface FormulaBooleanNode {
  type: 'boolean';
  value: boolean;
  position: number;
}

export interface FormulaReferenceNode {
  type: 'reference';
  /** Conteúdo entre chaves, sem espaços nas pontas (chave da coluna ou título não normalizado). */
  name: string;
  position: number;
}

export interface FormulaUnaryNode {
  type: 'unary';
  operator: '+' | '-';
  operand: FormulaAst;
  position: number;
}

export interface FormulaPercentNode {
  type: 'percent';
  operand: FormulaAst;
  position: number;
}

export interface FormulaBinaryNode {
  type: 'binary';
  operator: FormulaBinaryOperator;
  left: FormulaAst;
  right: FormulaAst;
  position: number;
}

export interface FormulaCallNode {
  type: 'call';
  /** Nome em maiúsculas. */
  name: string;
  args: FormulaAst[];
  position: number;
}

export type FormulaAst =
  | FormulaNumberNode
  | FormulaTextNode
  | FormulaBooleanNode
  | FormulaReferenceNode
  | FormulaUnaryNode
  | FormulaPercentNode
  | FormulaBinaryNode
  | FormulaCallNode;

export class FormulaSyntaxError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'FormulaSyntaxError';
    this.position = position;
  }
}
