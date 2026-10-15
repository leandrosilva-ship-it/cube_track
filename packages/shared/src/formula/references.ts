import type { FormulaAst } from './ast.js';

/** Referências de colunas: análise da árvore e conversão entre `{chave}` e `{Título}`. */

export interface FormulaColumn {
  key: string;
  title: string;
}

function children(node: FormulaAst): readonly FormulaAst[] {
  switch (node.type) {
    case 'unary':
    case 'percent':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    case 'call':
      return node.args;
    default:
      return [];
  }
}

function visit(node: FormulaAst, visitor: (node: FormulaAst) => void): void {
  visitor(node);
  for (const child of children(node)) visit(child, visitor);
}

/** Referências distintas, na ordem da primeira ocorrência. */
export function formulaReferences(ast: FormulaAst): string[] {
  const references = new Set<string>();
  visit(ast, (node) => {
    if (node.type === 'reference') references.add(node.name);
  });
  return [...references];
}

const VOLATILE_FUNCTIONS = new Set(['TODAY', 'NOW']);

/** Fórmula depende do relógio (TODAY/NOW) e precisa de recálculo periódico. */
export function isVolatileFormula(ast: FormulaAst): boolean {
  let volatile = false;
  visit(ast, (node) => {
    if (node.type === 'call' && VOLATILE_FUNCTIONS.has(node.name)) volatile = true;
  });
  return volatile;
}

/** Título comparável: sem acentos, minúsculo e com espaços colapsados. */
function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reescreve cada `{…}` fora de textos entre aspas. `replace` recebe o conteúdo sem espaços nas
 * pontas e devolve o novo conteúdo, ou `null` para manter o trecho original.
 */
function rewriteReferences(expression: string, replace: (name: string) => string | null): string {
  let output = '';
  let index = 0;
  while (index < expression.length) {
    const char = expression.charAt(index);
    if (char === '"') {
      // Copia o texto literal inteiro (com `""` escapado), sem reescrever chaves dentro dele.
      let end = index + 1;
      while (end < expression.length) {
        if (expression.charAt(end) === '"') {
          if (expression.charAt(end + 1) !== '"') break;
          end += 1;
        }
        end += 1;
      }
      output += expression.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === '{') {
      const close = expression.indexOf('}', index + 1);
      const nested = expression.indexOf('{', index + 1);
      if (close !== -1 && (nested === -1 || nested > close)) {
        const name = expression.slice(index + 1, close).trim();
        const replacement = name === '' ? null : replace(name);
        output += replacement === null ? expression.slice(index, close + 1) : `{${replacement}}`;
        index = close + 1;
        continue;
      }
    }
    output += char;
    index += 1;
  }
  return output;
}

/**
 * `{Título da coluna}` → `{chave}`. Chaves existentes têm prioridade; títulos são comparados sem
 * diferenciar maiúsculas/acentos (o primeiro título correspondente vence). Nomes desconhecidos ficam
 * como estão (avaliam para `#REF!`).
 */
export function normalizeFormulaReferences(
  expression: string,
  columns: readonly FormulaColumn[],
): string {
  const keys = new Set(columns.map((column) => column.key));
  const byTitle = new Map<string, string>();
  for (const column of columns) {
    const title = normalizeTitle(column.title);
    if (!byTitle.has(title)) byTitle.set(title, column.key);
  }
  return rewriteReferences(expression, (name) =>
    keys.has(name) ? name : (byTitle.get(normalizeTitle(name)) ?? null),
  );
}

/** `{chave}` → `{Título}` para exibição; títulos com chaves (`{`/`}`) mantêm a chave. */
export function displayFormula(expression: string, columns: readonly FormulaColumn[]): string {
  const titles = new Map(columns.map((column) => [column.key, column.title.trim()]));
  return rewriteReferences(expression, (name) => {
    const title = titles.get(name);
    return title === undefined || title === '' || /[{}]/.test(title) ? null : title;
  });
}
