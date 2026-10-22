import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { positionBetween, type FilterGroup } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { sha256Hex, randomToken } from '../../../core/crypto/secrets.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import {
  resolveFieldType,
  toBranding,
  toFieldDto,
  type FormDto,
  type FormFieldDto,
} from '../domain/form.js';

const { forms, formFields } = schema;

export interface CreateFormInput {
  name: string;
  description?: string | null | undefined;
  targetGroupId?: string | null | undefined;
}

export interface FormBrandingPatch {
  logoUrl?: string | null | undefined;
  primaryColor?: string | null | undefined;
  thankYouMessage?: string | null | undefined;
  redirectUrl?: string | null | undefined;
}

export interface UpdateFormInput {
  name?: string | undefined;
  description?: string | null | undefined;
  targetGroupId?: string | null | undefined;
  requiresLogin?: boolean | undefined;
  isActive?: boolean | undefined;
  closesAt?: string | null | undefined;
  settings?: FormBrandingPatch | undefined;
}

export interface UpsertFieldInput {
  columnKey?: string | null | undefined;
  label?: string | undefined;
  helpText?: string | null | undefined;
  fieldType?: string | undefined;
  isRequired?: boolean | undefined;
  showWhen?: FilterGroup | null | undefined;
  settings?: Record<string, unknown> | undefined;
  position?: { afterId?: string | undefined; beforeId?: string | undefined } | undefined;
}

function toDto(row: typeof forms.$inferSelect): FormDto {
  return {
    id: row.id,
    boardId: row.boardId,
    targetGroupId: row.targetGroupId,
    name: row.name,
    description: row.description,
    isPublic: row.isPublic,
    requiresLogin: row.requiresLogin,
    isActive: row.isActive,
    closesAt: row.closesAt?.toISOString() ?? null,
    settings: toBranding(row.settings),
    hasPublicLink: row.publicTokenHash !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** CRUD autenticado de formulários e campos (ADR 0049) — requer `form.manage` no board para escrever. */
@Injectable()
export class FormsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly definitions: BoardDefinitionRepository,
  ) {}

  async list(user: AuthPrincipal, boardId: string): Promise<FormDto[]> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(forms)
      .where(and(eq(forms.boardId, boardId), isNull(forms.deletedAt)))
      .orderBy(asc(forms.createdAt));
    return rows.map(toDto);
  }

  async get(user: AuthPrincipal, formId: string): Promise<FormDto> {
    const form = await this.find(formId);
    await this.access.assert(user, 'form.manage', { type: 'board', id: form.boardId }, 'Board');
    return toDto(form);
  }

  async create(user: AuthPrincipal, boardId: string, input: CreateFormInput): Promise<FormDto> {
    await this.access.assert(user, 'form.manage', { type: 'board', id: boardId }, 'Board');
    if (input.targetGroupId !== undefined && input.targetGroupId !== null) {
      await this.assertGroupOnBoard(boardId, input.targetGroupId);
    }
    const [row] = await this.runner.tx
      .insert(forms)
      .values({
        tenantId: user.tenantId,
        boardId,
        targetGroupId: input.targetGroupId ?? null,
        name: input.name,
        description: input.description ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar formulário');
    this.events.recordChange({
      action: 'form.created',
      entityType: 'form',
      entityId: row.id,
      boardId,
      after: { name: row.name },
    });
    return toDto(row);
  }

  async update(user: AuthPrincipal, formId: string, input: UpdateFormInput): Promise<FormDto> {
    const existing = await this.find(formId);
    await this.access.assert(
      user,
      'form.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    if (input.targetGroupId !== undefined && input.targetGroupId !== null) {
      await this.assertGroupOnBoard(existing.boardId, input.targetGroupId);
    }
    const settings =
      input.settings === undefined
        ? existing.settings
        : { ...toBranding(existing.settings), ...input.settings };
    const [row] = await this.runner.tx
      .update(forms)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        targetGroupId:
          input.targetGroupId === undefined ? existing.targetGroupId : input.targetGroupId,
        requiresLogin: input.requiresLogin ?? existing.requiresLogin,
        isActive: input.isActive ?? existing.isActive,
        closesAt:
          input.closesAt === undefined
            ? existing.closesAt
            : input.closesAt === null
              ? null
              : new Date(input.closesAt),
        settings,
        updatedAt: new Date(),
      })
      .where(eq(forms.id, formId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar formulário');
    this.events.recordChange({
      action: 'form.updated',
      entityType: 'form',
      entityId: row.id,
      boardId: row.boardId,
      before: { name: existing.name },
      after: { name: row.name },
    });
    return toDto(row);
  }

  async remove(user: AuthPrincipal, formId: string): Promise<void> {
    const existing = await this.find(formId);
    await this.access.assert(
      user,
      'form.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    await this.runner.tx
      .update(forms)
      .set({ deletedAt: new Date() })
      .where(eq(forms.id, formId));
    this.events.recordChange({
      action: 'form.deleted',
      entityType: 'form',
      entityId: formId,
      boardId: existing.boardId,
    });
  }

  /** Gera (ou revoga) o link público do formulário. O token em claro só é retornado uma vez. */
  async setPublic(
    user: AuthPrincipal,
    formId: string,
    makePublic: boolean,
  ): Promise<{ form: FormDto; token: string | null }> {
    const existing = await this.find(formId);
    await this.access.assert(
      user,
      'form.manage',
      { type: 'board', id: existing.boardId },
      'Board',
    );
    const token = makePublic ? randomToken() : null;
    const [row] = await this.runner.tx
      .update(forms)
      .set({
        isPublic: makePublic,
        publicTokenHash: makePublic ? sha256Hex(token ?? '') : null,
        updatedAt: new Date(),
      })
      .where(eq(forms.id, formId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar o link público');
    this.events.recordChange({
      action: makePublic ? 'form.public_link_issued' : 'form.public_link_revoked',
      entityType: 'form',
      entityId: row.id,
      boardId: row.boardId,
    });
    return { form: toDto(row), token };
  }

  // ----------------------------------------------------------------------------------- campos ---

  async listFields(user: AuthPrincipal, formId: string): Promise<FormFieldDto[]> {
    const form = await this.find(formId);
    await this.access.assert(user, 'form.manage', { type: 'board', id: form.boardId }, 'Board');
    const rows = await this.runner.tx
      .select()
      .from(formFields)
      .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
      .orderBy(asc(formFields.position));
    return rows.map(toFieldDto);
  }

  async addField(
    user: AuthPrincipal,
    formId: string,
    input: UpsertFieldInput,
  ): Promise<FormFieldDto> {
    const form = await this.find(formId);
    await this.access.assert(user, 'form.manage', { type: 'board', id: form.boardId }, 'Board');
    const columnKey = input.columnKey ?? null;
    const columnType = await this.columnTypeOf(form.boardId, columnKey);
    const fieldType = this.fieldType(columnKey, columnType, input.fieldType ?? 'text');
    const position = await this.resolvePosition(formId, input.position);
    const [row] = await this.runner.tx
      .insert(formFields)
      .values({
        tenantId: user.tenantId,
        formId,
        columnKey,
        label: input.label ?? columnKey ?? 'Campo',
        helpText: input.helpText ?? null,
        fieldType,
        isRequired: input.isRequired ?? false,
        showWhen: (input.showWhen ?? null) as Record<string, unknown> | null,
        settings: input.settings ?? {},
        position,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar campo');
    this.events.recordChange({
      action: 'form.field_added',
      entityType: 'form_field',
      entityId: row.id,
      boardId: form.boardId,
      after: { columnKey, fieldType },
    });
    return toFieldDto(row);
  }

  async updateField(
    user: AuthPrincipal,
    fieldId: string,
    input: UpsertFieldInput,
  ): Promise<FormFieldDto> {
    const existing = await this.findField(fieldId);
    const form = await this.find(existing.formId);
    await this.access.assert(user, 'form.manage', { type: 'board', id: form.boardId }, 'Board');
    const columnKey = input.columnKey === undefined ? existing.columnKey : input.columnKey;
    const columnType = await this.columnTypeOf(form.boardId, columnKey);
    const fieldType =
      input.columnKey === undefined && input.fieldType === undefined
        ? existing.fieldType
        : this.fieldType(columnKey, columnType, input.fieldType ?? existing.fieldType);
    const position =
      input.position === undefined ? existing.position : await this.resolvePosition(form.id, input.position);
    const [row] = await this.runner.tx
      .update(formFields)
      .set({
        columnKey,
        label: input.label ?? existing.label,
        helpText: input.helpText === undefined ? existing.helpText : input.helpText,
        fieldType,
        isRequired: input.isRequired ?? existing.isRequired,
        showWhen:
          input.showWhen === undefined
            ? existing.showWhen
            : (input.showWhen as Record<string, unknown> | null),
        settings: input.settings ?? existing.settings,
        position,
      })
      .where(eq(formFields.id, fieldId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar campo');
    this.events.recordChange({
      action: 'form.field_updated',
      entityType: 'form_field',
      entityId: row.id,
      boardId: form.boardId,
    });
    return toFieldDto(row);
  }

  async removeField(user: AuthPrincipal, fieldId: string): Promise<void> {
    const existing = await this.findField(fieldId);
    const form = await this.find(existing.formId);
    await this.access.assert(user, 'form.manage', { type: 'board', id: form.boardId }, 'Board');
    await this.runner.tx
      .update(formFields)
      .set({ deletedAt: new Date() })
      .where(eq(formFields.id, fieldId));
    this.events.recordChange({
      action: 'form.field_removed',
      entityType: 'form_field',
      entityId: fieldId,
      boardId: form.boardId,
    });
  }

  // --------------------------------------------------------------------------------- internos ---

  private fieldType(columnKey: string | null, columnType: string | undefined, requested: string) {
    try {
      return resolveFieldType(columnKey, columnType, requested);
    } catch (error) {
      throw new UnprocessableError(
        error instanceof Error ? error.message : 'Tipo de campo inválido.',
        'invalid_field_type',
      );
    }
  }

  private async columnTypeOf(
    boardId: string,
    columnKey: string | null,
  ): Promise<string | undefined> {
    if (columnKey === null || columnKey === 'name' || columnKey === 'description') return undefined;
    const definition = await this.definitions.load(this.runner.tx, boardId);
    const column = definition?.columns.find((entry) => entry.key === columnKey);
    if (column === undefined)
      throw new ValidationError([{ path: 'body.columnKey', message: 'Coluna inexistente.' }]);
    // Colunas vinculadas (ex.: bound a planned_end_date) só se gravam pelo campo nativo do item,
    // não por `values`; o formulário ainda não sabe emitir essa escrita (fora de escopo aqui).
    if (column.binding !== null) {
      throw new UnprocessableError(
        `A coluna "${columnKey}" é vinculada (${column.binding}) e não pode ser preenchida por formulário.`,
        'column_bound',
      );
    }
    return column.type;
  }

  private async assertGroupOnBoard(boardId: string, groupId: string): Promise<void> {
    const [row] = await this.runner.tx
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .where(
        and(
          eq(schema.groups.id, groupId),
          eq(schema.groups.boardId, boardId),
          isNull(schema.groups.deletedAt),
        ),
      );
    if (row === undefined)
      throw new ValidationError([{ path: 'body.targetGroupId', message: 'Grupo fora do board.' }]);
  }

  private async resolvePosition(
    formId: string,
    input: { afterId?: string | undefined; beforeId?: string | undefined } | undefined,
  ): Promise<string> {
    const rows = await this.runner.tx
      .select({ id: formFields.id, position: formFields.position })
      .from(formFields)
      .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
      .orderBy(asc(formFields.position));
    if (input?.afterId !== undefined) {
      const index = rows.findIndex((row) => row.id === input.afterId);
      if (index === -1)
        throw new ValidationError([
          { path: 'body.position.afterId', message: 'Campo de referência inexistente.' },
        ]);
      return positionBetween(rows[index]?.position ?? null, rows[index + 1]?.position ?? null);
    }
    if (input?.beforeId !== undefined) {
      const index = rows.findIndex((row) => row.id === input.beforeId);
      if (index === -1)
        throw new ValidationError([
          { path: 'body.position.beforeId', message: 'Campo de referência inexistente.' },
        ]);
      return positionBetween(index > 0 ? (rows[index - 1]?.position ?? null) : null, rows[index]?.position ?? null);
    }
    return positionBetween(rows.at(-1)?.position ?? null, null);
  }

  private async find(formId: string): Promise<typeof forms.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), isNull(forms.deletedAt)));
    if (row === undefined) throw new NotFoundError('Formulário');
    return row;
  }

  private async findField(fieldId: string): Promise<typeof formFields.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(formFields)
      .where(and(eq(formFields.id, fieldId), isNull(formFields.deletedAt)));
    if (row === undefined) throw new NotFoundError('Campo do formulário');
    return row;
  }
}
