import { isNativeFormFieldType, type FormFieldLike } from '@cube-track/shared';

/** Formulário (ADR 0049): cria itens num board/grupo; público (token) ou interno (login). */
export interface FormDto {
  id: string;
  boardId: string;
  targetGroupId: string | null;
  name: string;
  description: string | null;
  isPublic: boolean;
  requiresLogin: boolean;
  isActive: boolean;
  closesAt: string | null;
  settings: FormBranding;
  hasPublicLink: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Marca/aparência do formulário público (logo, cores, página de agradecimento). */
export interface FormBranding {
  logoUrl: string | null;
  primaryColor: string | null;
  thankYouMessage: string | null;
  redirectUrl: string | null;
}

export function toBranding(raw: Record<string, unknown> | null | undefined): FormBranding {
  const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  return {
    logoUrl: str(raw?.logoUrl),
    primaryColor: str(raw?.primaryColor),
    thankYouMessage: str(raw?.thankYouMessage),
    redirectUrl: str(raw?.redirectUrl),
  };
}

export interface FormFieldDto extends FormFieldLike {
  formId: string;
  label: string;
  helpText: string | null;
  settings: Record<string, unknown>;
  position: string;
}

export interface FormFieldRow {
  id: string;
  formId: string;
  columnKey: string | null;
  label: string;
  helpText: string | null;
  fieldType: string;
  isRequired: boolean;
  showWhen: unknown;
  settings: Record<string, unknown>;
  position: string;
}

export function toFieldDto(row: FormFieldRow): FormFieldDto {
  return {
    id: row.id,
    formId: row.formId,
    columnKey: row.columnKey,
    label: row.label,
    helpText: row.helpText,
    fieldType: row.fieldType,
    isRequired: row.isRequired,
    showWhen: (row.showWhen as FormFieldDto['showWhen']) ?? null,
    settings: row.settings,
    position: row.position,
  };
}

/** Deriva o `fieldType` correto a partir do tipo real da coluna (ou do tipo nativo informado). */
export function resolveFieldType(
  columnKey: string | null,
  columnType: string | undefined,
  requestedType: string,
): string {
  if (columnKey === null || columnKey === 'name' || columnKey === 'description') {
    if (!isNativeFormFieldType(requestedType)) {
      throw new Error('Tipo de campo inválido para resposta nativa.');
    }
    return requestedType;
  }
  if (columnType === undefined) throw new Error('Coluna inexistente no board.');
  return columnType;
}
