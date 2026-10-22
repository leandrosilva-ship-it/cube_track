import {
  FORM_DESCRIPTION_FIELD,
  FORM_NAME_FIELD,
  isNativeFormFieldType,
  isReadOnlyColumnType,
  matchesFilter,
  partialItemStateFromAnswers,
  type FormFieldLike,
} from '@cube-track/shared';

import type { BoardColumn, BoardDetail, FormField } from '@/lib/api/types';

/**
 * Opção de campo para o construtor: `'name'`/`'description'` (reservados, resposta nativa), ou uma
 * coluna real do board — sempre que `columnKey` for uma coluna, `fieldType` é o tipo dela (o
 * servidor recalcula de qualquer forma, ADR 0049).
 */
export interface FieldOption {
  columnKey: string | null;
  label: string;
  fieldType: string;
}

/** Colunas elegíveis para virar campo: nem vinculadas (`binding`) nem só-leitura/computadas. */
export function eligibleColumns(board: BoardDetail): BoardColumn[] {
  return board.columns.filter(
    (column) => column.binding === null && !isReadOnlyColumnType(column.type),
  );
}

/**
 * Perguntas "livres" (sem coluna, `columnKey: null`) — sempre disponíveis para adicionar, quantas
 * vezes quiser (ao contrário de nome/descrição/coluna, que fazem sentido uma vez só).
 */
export function nativeQuestionOptions(labels: Record<NativeQuestionType, string>): FieldOption[] {
  return NATIVE_QUESTION_TYPES.map((fieldType) => ({ columnKey: null, label: labels[fieldType], fieldType }));
}

/**
 * Campos reservados (nome/descrição) e colunas do board ainda não usados no formulário. Repetir um
 * já usado não quebra nada no servidor — é só uma conveniência de UX para não duplicar sem querer.
 */
export function boardFieldOptions(
  board: BoardDetail,
  existing: readonly FormField[],
  labels: { name: string; description: string },
): FieldOption[] {
  const used = new Set(existing.map((field) => field.columnKey));
  const options: FieldOption[] = [];
  if (!used.has(FORM_NAME_FIELD)) {
    options.push({ columnKey: FORM_NAME_FIELD, label: labels.name, fieldType: 'text' });
  }
  if (!used.has(FORM_DESCRIPTION_FIELD)) {
    options.push({ columnKey: FORM_DESCRIPTION_FIELD, label: labels.description, fieldType: 'long_text' });
  }
  for (const column of eligibleColumns(board)) {
    if (!used.has(column.key)) options.push({ columnKey: column.key, label: column.title, fieldType: column.type });
  }
  return options;
}

/** Tipos de campo nativo (sem coluna) — usados no "+ Pergunta" do construtor. */
export const NATIVE_QUESTION_TYPES = ['text', 'long_text', 'email', 'phone', 'number', 'date', 'checkbox'] as const;
export type NativeQuestionType = (typeof NATIVE_QUESTION_TYPES)[number];

/** Campos ordenados por `position` (fractional index, mesma convenção de itens/colunas). */
export function sortFieldsByPosition(fields: readonly FormField[]): FormField[] {
  return [...fields].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/**
 * `{afterId}` ou `{beforeId}` (nunca os dois — o servidor só lê um) para mover um campo até a
 * posição `targetIndex` na lista ordenada.
 */
export function positionFor(
  ordered: readonly FormField[],
  movingId: string,
  targetIndex: number,
): { afterId: string } | { beforeId: string } | Record<string, never> {
  const withoutMoving = ordered.filter((field) => field.id !== movingId);
  const clamped = Math.max(0, Math.min(targetIndex, withoutMoving.length));
  const before = withoutMoving[clamped - 1];
  if (before !== undefined) return { afterId: before.id };
  const after = withoutMoving[clamped];
  if (after !== undefined) return { beforeId: after.id };
  return {};
}

// --------------------------------------------------------------------------- preenchimento ---

/**
 * Campos visíveis dado o estado atual das respostas — "mostrar quando" reaproveita exatamente o
 * mesmo avaliador de "obrigatório quando" (`matchesFilter`, ADR 0039/0049). Um campo sem `showWhen`
 * está sempre visível.
 */
export function visibleFormFields<T extends FormFieldLike>(
  fields: readonly T[],
  answers: ReadonlyMap<string, unknown>,
  columnTypes: ReadonlyMap<string, string>,
): T[] {
  const item = partialItemStateFromAnswers(fields, answers, columnTypes);
  const columns = [...columnTypes.entries()].map(([key, type]) => ({ key, type, binding: null }));
  const context = { currentUserId: '', today: new Date().toISOString().slice(0, 10) };
  return fields.filter(
    (field) => field.showWhen === null || matchesFilter(field.showWhen, item, columns, context),
  );
}

/** Tipo (string livre) a validar com `validateNativeAnswer` — só os nativos têm formato fixo. */
export function isNativeField(fieldType: string): boolean {
  return isNativeFormFieldType(fieldType);
}
