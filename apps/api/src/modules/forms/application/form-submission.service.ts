import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseHandle } from '@cube-track/db';
import {
  isNativeFormFieldType,
  mapFormAnswers,
  matchesFilter,
  partialItemStateFromAnswers,
  validateNativeAnswer,
  type EvaluableColumn,
  type FormFieldLike,
} from '@cube-track/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { requireContext, type AuthPrincipal } from '../../../core/context/request-context.js';
import { sha256Hex } from '../../../core/crypto/secrets.js';
import { APP_DB } from '../../../core/database/tokens.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import type { ItemDto } from '../../work/domain/item.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import { ComputedFieldsService } from '../../work/application/computed-fields.service.js';
import { ItemWriter, type WriteContext } from '../../work/application/item-writer.js';
import { toBranding, toFieldDto, type FormBranding, type FormFieldDto } from '../domain/form.js';
import { CaptchaService, type Challenge } from './captcha.service.js';

const { forms, formFields, formSubmissions, groups } = schema;

/** Usuário sintético usado para itens criados por um envio de formulário público anônimo. */
const ANONYMOUS_USER_ID = '00000000-0000-7000-8000-000000000000';

export interface PublicFormDefinition {
  formId: string;
  boardId: string;
  name: string;
  description: string | null;
  requiresLogin: boolean;
  branding: FormBranding;
  fields: (FormFieldDto & {
    columnType: string | null;
    labels: { id: string; label: string; color: string; category: string }[];
    options: { id: string; label: string; color: string | null }[];
  })[];
  captcha: Challenge | null;
}

export interface SubmitFormInput {
  /** Resposta por id do campo (texto simples para campos nativos; formato de coluna para os demais). */
  answers: Record<string, unknown>;
  /** Campo-isca: deve chegar vazio. Presença de valor indica bot. */
  honeypot?: string | undefined;
  captcha?: { token: string; answer: number } | undefined;
}

export interface SubmitFormResult {
  itemId: string;
  branding: FormBranding;
}

interface ResolvedForm {
  tenantId: string;
  formId: string;
  boardId: string;
}

/**
 * Resolução e envio de formulários (ADR 0049): define o formulário (público por token ou interno
 * por id autenticado) e cria o item correspondente a partir das respostas. Reaproveita o `showWhen`
 * (mesma AST/avaliador de `requiredWhen`, ADR 0039) e o `ItemWriter` para validação por coluna,
 * valores padrão, calculadas e eventos — sem permissão de coluna/board para o caminho público (o
 * token/captcha é a própria autorização, como no link público de view, ADR 0047).
 */
@Injectable()
export class FormSubmissionService {
  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly definitions: BoardDefinitionRepository,
    private readonly computed: ComputedFieldsService,
    private readonly writer: ItemWriter,
    private readonly captcha: CaptchaService,
  ) {}

  // -------------------------------------------------------------------------------- público ---

  async publicDefinition(token: string): Promise<PublicFormDefinition> {
    const resolved = await this.resolveToken(token);
    return this.runner.run(
      { tenantId: resolved.tenantId, userId: null, actorKind: 'api' },
      async () => {
        const form = await this.loadForm(resolved.formId);
        const definition = await this.definitions.load(this.runner.tx, resolved.boardId);
        if (definition === null) throw new NotFoundError('Board');
        const fieldRows = await this.activeFields(resolved.formId);
        const byKey = new Map(definition.columns.map((column) => [column.key, column]));
        return {
          formId: form.id,
          boardId: form.boardId,
          name: form.name,
          description: form.description,
          requiresLogin: form.requiresLogin,
          branding: toBranding(form.settings),
          fields: fieldRows.map((row) => {
            const dto = toFieldDto(row);
            const column = dto.columnKey === null ? undefined : byKey.get(dto.columnKey);
            return {
              ...dto,
              columnType: column?.type ?? null,
              labels: column?.labels.map((label) => ({ ...label })) ?? [],
              options: column?.options.map((option) => ({ ...option })) ?? [],
            };
          }),
          captcha: form.requiresLogin ? null : this.captcha.issue(),
        };
      },
      { readOnly: true },
    );
  }

  async submitPublic(
    token: string,
    principal: AuthPrincipal | null,
    input: SubmitFormInput,
  ): Promise<SubmitFormResult> {
    const resolved = await this.resolveToken(token);
    if (principal !== null && principal.tenantId !== resolved.tenantId) {
      throw new ForbiddenError('Token de formulário de outra organização.', 'tenant_mismatch');
    }
    return this.runner.run(
      { tenantId: resolved.tenantId, userId: principal?.userId ?? null, actorKind: 'api' },
      async () => {
        const form = await this.loadForm(resolved.formId);
        if (form.requiresLogin && principal === null) {
          throw new UnauthorizedError('form_login_required', 'Este formulário exige login.');
        }
        if (!form.requiresLogin) this.assertAnonymousGuards(input);
        const context = await this.contextFor(resolved.tenantId, form.boardId, principal);
        const item = await this.createItem(context, form, input.answers, { checkPermissions: false });
        await this.recordSubmission(form, item.id, principal, input.answers);
        return { itemId: item.id, branding: toBranding(form.settings) };
      },
    );
  }

  // -------------------------------------------------------------------------------- interno ---

  async submitInternal(
    user: AuthPrincipal,
    formId: string,
    answers: Record<string, unknown>,
  ): Promise<ItemDto> {
    const form = await this.loadForm(formId);
    await this.access.assert(user, 'item.create', { type: 'board', id: form.boardId }, 'Board');
    const context = await this.writer.context(user, form.boardId);
    const item = await this.createItem(context, form, answers, { checkPermissions: true });
    await this.recordSubmission(form, item.id, user, answers);
    return this.writer.dto(context, item);
  }

  // --------------------------------------------------------------------------------- internos ---

  private assertAnonymousGuards(input: SubmitFormInput): void {
    if (input.honeypot !== undefined && input.honeypot.trim() !== '') {
      // Resposta silenciosa e genérica — não revela ao bot qual verificação falhou.
      throw new UnprocessableError('Envio rejeitado.', 'submission_rejected');
    }
    if (
      input.captcha === undefined ||
      !this.captcha.verify(input.captcha.token, input.captcha.answer)
    ) {
      throw new UnprocessableError('Captcha inválido ou expirado.', 'captcha_invalid');
    }
  }

  private async createItem(
    context: WriteContext,
    form: typeof forms.$inferSelect,
    rawAnswers: Record<string, unknown>,
    options: { checkPermissions: boolean },
  ) {
    if (!form.isActive) throw new UnprocessableError('Formulário inativo.', 'form_inactive');
    if (form.closesAt !== null && form.closesAt.getTime() <= Date.now()) {
      throw new UnprocessableError('Formulário encerrado.', 'form_closed');
    }
    const fieldRows = await this.activeFields(form.id);
    const fields: FormFieldLike[] = fieldRows.map(toFieldDto);
    const answers = new Map<string, unknown>(Object.entries(rawAnswers));
    const columnTypes = new Map(context.definition.columns.map((column) => [column.key, column.type]));
    const evaluable: EvaluableColumn[] = context.definition.columns.map((column) => ({
      key: column.key,
      type: column.type,
      binding: column.binding,
    }));
    const state = partialItemStateFromAnswers(fields, answers, columnTypes);
    for (const field of fields) {
      const visible =
        field.showWhen === null ||
        matchesFilter(field.showWhen, state, evaluable, context.conditions);
      if (!visible) continue;
      const answer = answers.get(field.id);
      const answered = answers.has(field.id) && answer !== null && answer !== undefined && answer !== '';
      if (field.isRequired && !answered) {
        throw new ValidationError([
          { path: `body.answers.${field.id}`, message: 'Resposta obrigatória.' },
        ]);
      }
      if (answered && isNativeFormFieldType(field.fieldType) && !validateNativeAnswer(field.fieldType, answer)) {
        throw new ValidationError([
          { path: `body.answers.${field.id}`, message: 'Resposta inválida para este campo.' },
        ]);
      }
    }
    const mapped = mapFormAnswers(fields, answers, columnTypes);
    const groupId = form.targetGroupId ?? (await this.firstGroup(form.boardId));
    if (groupId === null) {
      throw new UnprocessableError('O board não tem nenhum grupo ativo.', 'no_group_available');
    }
    const position = await this.writer.resolvePosition(groupId, null, undefined);
    const item = await this.writer.insert(
      context,
      {
        groupId,
        name: mapped.name ?? form.name,
        values: mapped.values,
        description: mapped.descriptionText,
        position,
      },
      { checkPermissions: options.checkPermissions, enforceRequired: false },
    );
    await this.writer.emitCreated(context, item, 'created');
    return item;
  }

  private async recordSubmission(
    form: typeof forms.$inferSelect,
    itemId: string,
    principal: AuthPrincipal | null,
    answers: Record<string, unknown>,
  ): Promise<void> {
    const store = requireContext();
    await this.runner.tx.insert(formSubmissions).values({
      tenantId: form.tenantId,
      formId: form.id,
      itemId,
      submittedBy: principal?.userId ?? null,
      data: answers,
      ip: store.ip,
      userAgent: store.userAgent,
    });
  }

  private async contextFor(
    tenantId: string,
    boardId: string,
    principal: AuthPrincipal | null,
  ): Promise<WriteContext> {
    if (principal !== null) return this.writer.context(principal, boardId);
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) throw new NotFoundError('Board');
    const prepared = await this.computed.prepare(tenantId, definition, []);
    return {
      user: { userId: ANONYMOUS_USER_ID, tenantId, sessionId: 'public-form', kind: 'guest' },
      boardId,
      definition,
      visibility: { hidden: new Set(), hiddenBindings: new Set(), columns: [] },
      peopleKeys: definition.columns
        .filter((column) => column.type === 'people')
        .map((column) => column.key),
      prepared,
      conditions: { currentUserId: ANONYMOUS_USER_ID, currentUserTeamIds: [], today: prepared.today },
    };
  }

  private async firstGroup(boardId: string): Promise<string | null> {
    const [row] = await this.runner.tx
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.position))
      .limit(1);
    return row?.id ?? null;
  }

  private async activeFields(formId: string) {
    return this.runner.tx
      .select()
      .from(formFields)
      .where(and(eq(formFields.formId, formId), isNull(formFields.deletedAt)))
      .orderBy(asc(formFields.position));
  }

  private async loadForm(formId: string): Promise<typeof forms.$inferSelect> {
    const [row] = await this.runner.tx
      .select()
      .from(forms)
      .where(and(eq(forms.id, formId), isNull(forms.deletedAt)));
    if (row === undefined) throw new NotFoundError('Formulário');
    return row;
  }

  /** Resolve o token público (hash) sem contexto de tenant, via `app.resolve_public_form`. */
  private async resolveToken(token: string): Promise<ResolvedForm> {
    const result = await this.database.db.execute<{
      tenant_id: string;
      form_id: string;
      board_id: string;
    }>(sql`select tenant_id, form_id, board_id from app.resolve_public_form(${sha256Hex(token)})`);
    const row = result.rows[0];
    if (row === undefined) {
      throw new UnauthorizedError('form_link_invalid', 'Link de formulário inválido ou inativo.');
    }
    return { tenantId: row.tenant_id, formId: row.form_id, boardId: row.board_id };
  }
}
