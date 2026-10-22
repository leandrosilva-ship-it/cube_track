import type { ItemState } from './columns/conditions.js';
import type { FilterGroup } from './query.js';

/**
 * Formulário público/interno (Prompt 8): campos normalmente mapeados a uma coluna do board, com
 * lógica condicional reaproveitando a mesma AST de filtro da obrigatoriedade condicional (ADR 0039,
 * `matchesFilter`) — "mostrar quando" é avaliado exatamente como "obrigatório quando".
 *
 * `columnKey` tem dois valores reservados além de uma chave de coluna real: `'name'` (nome do item,
 * todo formulário deve ter um) e `'description'` (descrição nativa); `null` = resposta só fica
 * registrada no envio (`form_submissions.data`), sem virar campo do item.
 */

export const FORM_NAME_FIELD = 'name';
export const FORM_DESCRIPTION_FIELD = 'description';

/** Tipos de campo que capturam um valor "livre" (sem opções pré-existentes de uma coluna). */
export const NATIVE_FORM_FIELD_TYPES = [
  'text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'checkbox',
] as const;
export type NativeFormFieldType = (typeof NATIVE_FORM_FIELD_TYPES)[number];

export function isNativeFormFieldType(value: string): value is NativeFormFieldType {
  return (NATIVE_FORM_FIELD_TYPES as readonly string[]).includes(value);
}

export interface FormFieldLike {
  id: string;
  columnKey: string | null;
  fieldType: string;
  isRequired: boolean;
  showWhen: FilterGroup | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A resposta (valor digitado/marcado pelo usuário) é válida para o tipo "nativo" do campo? */
export function validateNativeAnswer(fieldType: NativeFormFieldType, value: unknown): boolean {
  switch (fieldType) {
    case 'email':
      return typeof value === 'string' && EMAIL_RE.test(value);
    case 'number':
      return (
        (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) || typeof value === 'number'
      );
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'checkbox':
      return typeof value === 'boolean';
    case 'phone':
      return typeof value === 'string' && /^\+?[\d\s()-]{6,20}$/.test(value);
    case 'text':
    case 'long_text':
      return typeof value === 'string';
  }
}

/**
 * Envolve a resposta de um campo "nativo" no formato de valor armazenado da coluna correspondente
 * (igual ao que `parseColumnValue` de `columns/registry.ts` espera). Campos de escolha (status,
 * dropdown, pessoas…) já chegam nesse formato direto do cliente (reaproveitam `ValueField` da
 * Tabela) — por isso só os tipos "nativos" precisam de empacotamento aqui.
 */
export function wrapNativeAnswer(
  fieldType: NativeFormFieldType,
  value: unknown,
): Record<string, unknown> | null {
  switch (fieldType) {
    case 'text':
    case 'long_text':
      return typeof value === 'string' ? { text: value } : null;
    case 'email':
      return typeof value === 'string' ? { email: value } : null;
    case 'phone':
      return typeof value === 'string' ? { phone: value } : null;
    case 'number':
      return typeof value === 'string' || typeof value === 'number' ? { n: String(value) } : null;
    case 'date':
      return typeof value === 'string' ? { d: value } : null;
    case 'checkbox':
      return typeof value === 'boolean' ? { checked: value } : null;
  }
}

export interface MappedAnswers {
  name: string | null;
  descriptionText: string | null;
  /** Valores por chave de coluna real, já no formato armazenado (pronto para `parseColumnValue`). */
  values: Record<string, unknown>;
}

/**
 * Converte as respostas (por id do campo) em nome/descrição/valores de coluna do item, usando o
 * tipo de cada coluna real (`columnTypes`) para empacotar respostas de campos "nativos". Campos sem
 * resposta são ignorados; `columnKey: null` nunca entra no resultado (só fica no envio bruto).
 */
export function mapFormAnswers(
  fields: readonly FormFieldLike[],
  answers: ReadonlyMap<string, unknown>,
  columnTypes: ReadonlyMap<string, string>,
): MappedAnswers {
  let name: string | null = null;
  let descriptionText: string | null = null;
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (!answers.has(field.id)) continue;
    const raw = answers.get(field.id);
    if (field.columnKey === FORM_NAME_FIELD) {
      if (typeof raw === 'string' && raw.trim() !== '') name = raw.trim();
      continue;
    }
    if (field.columnKey === FORM_DESCRIPTION_FIELD) {
      if (typeof raw === 'string') descriptionText = raw;
      continue;
    }
    if (field.columnKey === null) continue;
    const columnType = columnTypes.get(field.columnKey);
    if (columnType === undefined) continue;
    const wrapped = isNativeFormFieldType(field.fieldType)
      ? wrapNativeAnswer(field.fieldType, raw)
      : (raw as Record<string, unknown> | null);
    if (wrapped !== null) values[field.columnKey] = wrapped;
  }
  return { name, descriptionText, values };
}

/**
 * Estado parcial do item (para `matchesFilter` avaliar `showWhen`) a partir das respostas dadas até
 * agora — usado tanto no preenchimento (cliente, ao vivo) quanto na validação do envio (servidor).
 */
export function partialItemStateFromAnswers(
  fields: readonly FormFieldLike[],
  answers: ReadonlyMap<string, unknown>,
  columnTypes: ReadonlyMap<string, string>,
): ItemState {
  const mapped = mapFormAnswers(fields, answers, columnTypes);
  return {
    name: mapped.name ?? '',
    groupId: '',
    values: mapped.values,
    fields: {},
    completed: false,
  };
}
