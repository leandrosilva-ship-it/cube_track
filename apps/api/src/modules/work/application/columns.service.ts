import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  COLUMN_TYPE_SPECS,
  ColumnPermissionsSchema,
  defaultStatusLabels,
  filterFields,
  FilterGroupSchema,
  FormulaSyntaxError,
  initialPositions,
  isColumnType,
  newId,
  normalizeForMatch,
  normalizeFormulaReferences,
  parseFormula,
  positionBetween,
  READ_ONLY_COLUMN_TYPES,
  type ColumnPermissions,
  type FilterGroup,
  type TemplateLocale,
} from '@cube-track/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import type { BoardDefinition, ColumnDefinition } from '../domain/board-definition.js';
import { BoardDefinitionRepository } from '../infrastructure/board-definition.repository.js';

const { columnDefinitions, statusLabels, dropdownOptions, tenants, boards } = schema;

export interface LabelInput {
  id?: string | undefined;
  label: string;
  color: string;
  category: 'not_started' | 'in_progress' | 'done' | 'stuck';
}

export interface OptionInput {
  id?: string | undefined;
  label: string;
  color?: string | null | undefined;
}

export interface ColumnPositionInput {
  afterKey?: string | undefined;
  beforeKey?: string | undefined;
}

export interface CreateColumnInput {
  type: string;
  title: string;
  description?: string | null | undefined;
  settings?: Record<string, unknown> | undefined;
  width?: number | null | undefined;
  position?: ColumnPositionInput | undefined;
  labels?: Omit<LabelInput, 'id'>[] | undefined;
  options?: Omit<OptionInput, 'id'>[] | undefined;
  isRequired?: boolean | undefined;
  requiredWhen?: FilterGroup | null | undefined;
  permissions?: ColumnPermissions | undefined;
}

export interface UpdateColumnInput {
  title?: string | undefined;
  description?: string | null | undefined;
  settings?: Record<string, unknown> | undefined;
  width?: number | null | undefined;
  position?: ColumnPositionInput | undefined;
  isRequired?: boolean | undefined;
  isHidden?: boolean | undefined;
  requiredWhen?: FilterGroup | null | undefined;
  defaultValue?: Record<string, unknown> | null | undefined;
  permissions?: ColumnPermissions | undefined;
}

type ColumnRow = typeof columnDefinitions.$inferSelect;

/** Administração de colunas do board (permissão `column.manage`). */
@Injectable()
export class ColumnsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly definitions: BoardDefinitionRepository,
  ) {}

  async create(user: AuthPrincipal, boardId: string, input: CreateColumnInput) {
    await this.assertManage(user, boardId);
    const tx = this.runner.tx;
    if (!isColumnType(input.type))
      throw new ValidationError([{ path: 'body.type', message: 'Tipo de coluna desconhecido.' }]);
    const definition = await this.definition(boardId);
    const key = await this.uniqueKey(boardId, input.title);
    const settings = this.validateSettings(definition, input.type, input.settings ?? {}, null);
    const requiredWhen = this.validateRequiredWhen(definition, input.requiredWhen ?? null, key);
    const id = newId();
    await tx.insert(columnDefinitions).values({
      id,
      tenantId: user.tenantId,
      boardId,
      key,
      type: input.type,
      title: input.title,
      description: input.description ?? null,
      settings,
      width: input.width ?? null,
      isRequired: input.isRequired ?? false,
      requiredWhen,
      permissions: ColumnPermissionsSchema.parse(input.permissions ?? {}),
      position: this.position(definition.columns, input.position, null),
      createdBy: user.userId,
    });
    if (input.type === 'status') {
      const labels = input.labels ?? defaultStatusLabels(await this.locale(user.tenantId));
      await this.insertLabels(user, id, labels);
    }
    if (input.type === 'dropdown' && input.options !== undefined)
      await this.insertOptions(user, id, input.options);
    if (input.type === 'auto_id') await tx.execute(sql`select app.backfill_auto_ids(${id}::uuid)`);
    this.events.recordChange({
      action: 'column.created',
      entityType: 'column',
      entityId: id,
      boardId,
      after: { key, type: input.type, title: input.title, settings },
    });
    await this.access.invalidate(user.tenantId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'column.created',
      aggregateType: 'column',
      aggregateId: id,
      boardId,
      payload: { columnId: id, key },
      actorId: user.userId,
    });
    return { id, key };
  }

  async update(user: AuthPrincipal, boardId: string, columnId: string, input: UpdateColumnInput) {
    await this.assertManage(user, boardId);
    const tx = this.runner.tx;
    const column = await this.row(boardId, columnId);
    const definition = await this.definition(boardId);
    const current = definition.columns.find((entry) => entry.id === columnId);
    if (current === undefined) throw new NotFoundError('Coluna');
    const set: Partial<typeof columnDefinitions.$inferInsert> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.description !== undefined) set.description = input.description;
    if (input.width !== undefined) set.width = input.width;
    if (input.isRequired !== undefined) set.isRequired = input.isRequired;
    if (input.isHidden !== undefined) set.isHidden = input.isHidden;
    if (input.permissions !== undefined)
      set.permissions = ColumnPermissionsSchema.parse(input.permissions);
    if (input.settings !== undefined)
      set.settings = this.validateSettings(
        definition,
        column.type,
        { ...column.settings, ...input.settings },
        column.key,
      );
    if (input.requiredWhen !== undefined)
      set.requiredWhen = this.validateRequiredWhen(definition, input.requiredWhen, column.key);
    if (input.defaultValue !== undefined)
      set.defaultValue =
        input.defaultValue === null ? null : this.validateDefault(current, input.defaultValue);
    if (input.position !== undefined)
      set.position = this.position(
        definition.columns.filter((entry) => entry.id !== columnId),
        input.position,
        column.key,
      );
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(set)) before[key] = (column as Record<string, unknown>)[key];
    if (Object.keys(set).length === 0) return { id: columnId, key: column.key, changes: {} };
    await tx.update(columnDefinitions).set(set).where(eq(columnDefinitions.id, columnId));
    await this.changed(user, boardId, column, before, set);
    return { id: columnId, key: column.key, changes: set };
  }

  /** Substitui os rótulos de uma coluna de status; valores com rótulos removidos são limpos. */
  async replaceLabels(
    user: AuthPrincipal,
    boardId: string,
    columnId: string,
    labels: LabelInput[],
  ) {
    await this.assertManage(user, boardId);
    const column = await this.row(boardId, columnId);
    if (column.type !== 'status')
      throw new UnprocessableError('A coluna não é de status.', 'not_status');
    if (labels.length === 0 || labels.length > 40)
      throw new ValidationError([{ path: 'body.labels', message: 'Entre 1 e 40 rótulos.' }]);
    const tx = this.runner.tx;
    const existing = await tx
      .select({ id: statusLabels.id, label: statusLabels.label })
      .from(statusLabels)
      .where(and(eq(statusLabels.columnId, columnId), isNull(statusLabels.deletedAt)));
    const keep = new Set(labels.flatMap((label) => (label.id === undefined ? [] : [label.id])));
    if ([...keep].some((id) => !existing.some((row) => row.id === id)))
      throw new ValidationError([{ path: 'body.labels', message: 'Rótulo de outra coluna.' }]);
    const removed = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
    const positions = initialPositions(labels.length);
    for (const [index, label] of labels.entries()) {
      const position = positions[index] ?? 'a0';
      if (label.id === undefined) {
        await tx.insert(statusLabels).values({
          tenantId: user.tenantId,
          columnId,
          label: label.label,
          color: label.color,
          category: label.category,
          position,
          createdBy: user.userId,
        });
      } else {
        await tx
          .update(statusLabels)
          .set({ label: label.label, color: label.color, category: label.category, position })
          .where(eq(statusLabels.id, label.id));
      }
    }
    if (removed.length > 0) {
      await tx
        .update(statusLabels)
        .set({ deletedAt: new Date() })
        .where(inArray(statusLabels.id, removed));
      await tx.execute(sql`
        update items set values = values - ${column.key}::text, version = version + 1
        where board_id = ${boardId}::uuid and values -> ${column.key}::text ->> 'labelId' in (${sql.join(
          removed.map((id) => sql`${id}`),
          sql`, `,
        )})`);
    }
    await this.changed(user, boardId, column, { labels: existing }, { labels });
    return { id: columnId, key: column.key };
  }

  /** Substitui as opções de um dropdown; opções removidas saem dos valores dos itens. */
  async replaceOptions(
    user: AuthPrincipal,
    boardId: string,
    columnId: string,
    options: OptionInput[],
  ) {
    await this.assertManage(user, boardId);
    const column = await this.row(boardId, columnId);
    if (column.type !== 'dropdown')
      throw new UnprocessableError('A coluna não é de lista.', 'not_dropdown');
    if (options.length > 500)
      throw new ValidationError([{ path: 'body.options', message: 'Máximo de 500 opções.' }]);
    const normalized = options.map((option) => normalizeForMatch(option.label));
    if (new Set(normalized).size !== normalized.length)
      throw new ValidationError([{ path: 'body.options', message: 'Opções repetidas.' }]);
    const tx = this.runner.tx;
    const existing = await tx
      .select({ id: dropdownOptions.id, label: dropdownOptions.label })
      .from(dropdownOptions)
      .where(and(eq(dropdownOptions.columnId, columnId), isNull(dropdownOptions.deletedAt)));
    const keep = new Set(options.flatMap((option) => (option.id === undefined ? [] : [option.id])));
    const removed = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (removed.length > 0) {
      await tx
        .update(dropdownOptions)
        .set({ deletedAt: new Date() })
        .where(inArray(dropdownOptions.id, removed));
      const list = sql.join(
        removed.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(sql`
        update items set values = jsonb_set(values, array[${column.key}::text, 'optionIds'::text],
          coalesce((select jsonb_agg(o) from jsonb_array_elements_text(values -> ${column.key}::text -> 'optionIds') o
                    where o not in (${list})), '[]'::jsonb)), version = version + 1
        where board_id = ${boardId}::uuid and values -> ${column.key}::text -> 'optionIds' ?| array[${list}]`);
    }
    const positions = initialPositions(options.length);
    for (const [index, option] of options.entries()) {
      const position = positions[index] ?? 'a0';
      if (option.id === undefined) {
        await tx.insert(dropdownOptions).values({
          tenantId: user.tenantId,
          columnId,
          label: option.label,
          color: option.color ?? null,
          position,
          createdBy: user.userId,
        });
      } else {
        await tx
          .update(dropdownOptions)
          .set({ label: option.label, color: option.color ?? null, position })
          .where(and(eq(dropdownOptions.id, option.id), eq(dropdownOptions.columnId, columnId)));
      }
    }
    await this.changed(user, boardId, column, { options: existing }, { options });
    return { id: columnId, key: column.key };
  }

  /** Duplica a coluna (configuração, rótulos/opções e, opcionalmente, os valores). */
  async duplicate(user: AuthPrincipal, boardId: string, columnId: string, includeValues: boolean) {
    await this.assertManage(user, boardId);
    const tx = this.runner.tx;
    const column = await this.row(boardId, columnId);
    if (column.binding !== null)
      throw new UnprocessableError('Colunas vinculadas não podem ser duplicadas.', 'column_bound');
    const definition = await this.definition(boardId);
    const source = definition.columns.find((entry) => entry.id === columnId);
    if (source === undefined) throw new NotFoundError('Coluna');
    const key = await this.uniqueKey(boardId, `${column.title} copia`);
    const id = newId();
    const next = definition.columns[definition.columns.indexOf(source) + 1];
    await tx.insert(columnDefinitions).values({
      id,
      tenantId: user.tenantId,
      boardId,
      key,
      type: column.type,
      title: column.title,
      description: column.description,
      settings: column.settings,
      width: column.width,
      isRequired: false,
      requiredWhen: null,
      defaultValue: null,
      permissions: column.permissions,
      position: positionBetween(column.position, next?.position ?? null),
      createdBy: user.userId,
    });
    const labelMap: Record<string, string> = {};
    for (const label of source.labels) {
      const labelId = newId();
      labelMap[label.id] = labelId;
      await tx.insert(statusLabels).values({
        id: labelId,
        tenantId: user.tenantId,
        columnId: id,
        label: label.label,
        color: label.color,
        category: label.category,
        position: label.position,
        createdBy: user.userId,
      });
    }
    for (const option of source.options) {
      const optionId = newId();
      labelMap[option.id] = optionId;
      await tx.insert(dropdownOptions).values({
        id: optionId,
        tenantId: user.tenantId,
        columnId: id,
        label: option.label,
        color: option.color,
        position: option.position,
        createdBy: user.userId,
      });
    }
    const copyable =
      !(isColumnType(column.type) && READ_ONLY_COLUMN_TYPES.has(column.type)) &&
      column.type !== 'file';
    if (includeValues && copyable) {
      const map = JSON.stringify(labelMap);
      const copied =
        column.type === 'status'
          ? sql`jsonb_build_object('labelId', ${map}::jsonb ->> (values -> ${column.key}::text ->> 'labelId'))`
          : column.type === 'dropdown'
            ? sql`jsonb_build_object('optionIds', coalesce((select jsonb_agg(${map}::jsonb ->> o) from jsonb_array_elements_text(values -> ${column.key}::text -> 'optionIds') o), '[]'::jsonb))`
            : sql`values -> ${column.key}::text`;
      await tx.execute(sql`
        update items set values = values || jsonb_build_object(${key}::text, ${copied}), version = version + 1
        where board_id = ${boardId}::uuid and deleted_at is null and values ? ${column.key}::text`);
    }
    if (column.type === 'auto_id') await tx.execute(sql`select app.backfill_auto_ids(${id}::uuid)`);
    this.events.recordChange({
      action: 'column.duplicated',
      entityType: 'column',
      entityId: id,
      boardId,
      after: { key, sourceKey: column.key, includeValues },
    });
    await this.access.invalidate(user.tenantId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'column.created',
      aggregateType: 'column',
      aggregateId: id,
      boardId,
      payload: { columnId: id, key },
      actorId: user.userId,
    });
    return { id, key };
  }

  async remove(user: AuthPrincipal, boardId: string, columnId: string): Promise<void> {
    await this.assertManage(user, boardId);
    const column = await this.row(boardId, columnId);
    if (column.isSystem)
      throw new UnprocessableError('Colunas do sistema não podem ser excluídas.', 'column_system');
    await this.runner.tx
      .update(columnDefinitions)
      .set({ deletedAt: new Date() })
      .where(eq(columnDefinitions.id, columnId));
    this.events.recordChange({
      action: 'column.deleted',
      entityType: 'column',
      entityId: columnId,
      boardId,
      before: { key: column.key, type: column.type, title: column.title },
    });
    await this.access.invalidate(user.tenantId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'column.deleted',
      aggregateType: 'column',
      aggregateId: columnId,
      boardId,
      payload: { columnId, key: column.key },
      actorId: user.userId,
    });
  }

  /** Define a coluna de status principal do board (conclusão e "atrasados"). */
  async setStatusColumn(user: AuthPrincipal, boardId: string, columnKey: string): Promise<void> {
    await this.assertManage(user, boardId);
    const definition = await this.definition(boardId);
    if (!definition.columns.some((column) => column.key === columnKey && column.type === 'status'))
      throw new ValidationError([
        { path: 'body.statusColumnKey', message: 'Coluna de status inexistente.' },
      ]);
    await this.runner.tx
      .update(boards)
      .set({ settings: { ...definition.settings, statusColumnKey: columnKey } })
      .where(eq(boards.id, boardId));
    this.events.recordChange({
      action: 'board.status_column_changed',
      entityType: 'board',
      entityId: boardId,
      boardId,
      before: { statusColumnKey: definition.settings.statusColumnKey ?? null },
      after: { statusColumnKey: columnKey },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'board.updated',
      aggregateType: 'board',
      aggregateId: boardId,
      boardId,
      payload: { boardId, changes: { statusColumnKey: columnKey } },
      actorId: user.userId,
    });
  }

  // ------------------------------------------------------------------------------ internos ---

  private async assertManage(user: AuthPrincipal, boardId: string): Promise<void> {
    await this.access.assert(user, 'column.manage', { type: 'board', id: boardId }, 'Board');
  }

  private async definition(boardId: string): Promise<BoardDefinition> {
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) throw new NotFoundError('Board');
    return definition;
  }

  private async row(boardId: string, columnId: string): Promise<ColumnRow> {
    const [column] = await this.runner.tx
      .select()
      .from(columnDefinitions)
      .where(
        and(
          eq(columnDefinitions.id, columnId),
          eq(columnDefinitions.boardId, boardId),
          isNull(columnDefinitions.deletedAt),
        ),
      );
    if (column === undefined) throw new NotFoundError('Coluna');
    return column;
  }

  private async changed(
    user: AuthPrincipal,
    boardId: string,
    column: ColumnRow,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<void> {
    this.events.recordChange({
      action: 'column.updated',
      entityType: 'column',
      entityId: column.id,
      boardId,
      before,
      after,
    });
    await this.access.invalidate(user.tenantId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'column.updated',
      aggregateType: 'column',
      aggregateId: column.id,
      boardId,
      payload: { columnId: column.id, key: column.key, changes: after },
      actorId: user.userId,
    });
  }

  private async locale(tenantId: string): Promise<TemplateLocale> {
    const [tenant] = await this.runner.tx
      .select({ locale: tenants.locale })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const locale = tenant?.locale ?? 'pt-BR';
    return locale.startsWith('en') ? 'en' : locale.startsWith('es') ? 'es' : 'pt-BR';
  }

  /** Chave estável derivada do título (`c_<slug>`), única no board (inclui excluídas). */
  private async uniqueKey(boardId: string, title: string): Promise<string> {
    const slug = normalizeForMatch(title)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    const base = `c_${slug === '' ? 'coluna' : slug}`;
    const rows = await this.runner.tx
      .select({ key: columnDefinitions.key })
      .from(columnDefinitions)
      .where(eq(columnDefinitions.boardId, boardId));
    const taken = new Set(rows.map((row) => row.key));
    if (!taken.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}_${String(suffix)}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private position(
    columns: readonly { key: string; position: string }[],
    input: ColumnPositionInput | undefined,
    self: string | null,
  ): string {
    const ordered = [...columns]
      .filter((column) => column.key !== self)
      .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    const indexOf = (key: string) => {
      const index = ordered.findIndex((column) => column.key === key);
      if (index === -1)
        throw new ValidationError([
          { path: 'body.position', message: 'Coluna de referência inexistente.' },
        ]);
      return index;
    };
    if (input?.afterKey !== undefined) {
      const index = indexOf(input.afterKey);
      return positionBetween(
        ordered[index]?.position ?? null,
        ordered[index + 1]?.position ?? null,
      );
    }
    if (input?.beforeKey !== undefined) {
      const index = indexOf(input.beforeKey);
      return positionBetween(
        ordered[index - 1]?.position ?? null,
        ordered[index]?.position ?? null,
      );
    }
    return positionBetween(ordered.at(-1)?.position ?? null, null);
  }

  private async insertLabels(
    user: AuthPrincipal,
    columnId: string,
    labels: Omit<LabelInput, 'id'>[],
  ): Promise<void> {
    const positions = initialPositions(labels.length);
    if (labels.length === 0) return;
    await this.runner.tx.insert(statusLabels).values(
      labels.map((label, index) => ({
        tenantId: user.tenantId,
        columnId,
        label: label.label,
        color: label.color,
        category: label.category,
        position: positions[index] ?? 'a0',
        createdBy: user.userId,
      })),
    );
  }

  private async insertOptions(
    user: AuthPrincipal,
    columnId: string,
    options: Omit<OptionInput, 'id'>[],
  ): Promise<void> {
    if (options.length === 0) return;
    const positions = initialPositions(options.length);
    await this.runner.tx.insert(dropdownOptions).values(
      options.map((option, index) => ({
        tenantId: user.tenantId,
        columnId,
        label: option.label,
        color: option.color ?? null,
        position: positions[index] ?? 'a0',
        createdBy: user.userId,
      })),
    );
  }

  /** Configurações por tipo (Zod do registro) + regras de fórmula, espelho e rollup. */
  private validateSettings(
    definition: BoardDefinition,
    type: string,
    raw: Record<string, unknown>,
    self: string | null,
  ): Record<string, unknown> {
    if (!isColumnType(type))
      throw new ValidationError([{ path: 'body.type', message: 'Tipo desconhecido.' }]);
    const settings = { ...raw };
    if (type === 'formula' && typeof settings.expression === 'string') {
      const expression = normalizeFormulaReferences(settings.expression, definition.columns);
      settings.expression = expression;
      try {
        parseFormula(expression);
      } catch (error) {
        if (error instanceof FormulaSyntaxError)
          throw new UnprocessableError(error.message, 'formula_syntax', {
            position: error.position,
          });
        throw error;
      }
    }
    const parsed = COLUMN_TYPE_SPECS[type].settings.safeParse(settings);
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          path: ['body', 'settings', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    const value = parsed.data as Record<string, unknown>;
    const byKey = (key: unknown) =>
      definition.columns.find((column) => column.key === key && column.key !== self);
    if (type === 'mirror' || (type === 'rollup' && value.source === 'relation')) {
      const relation = byKey(value.relationColumnKey);
      if (relation?.type !== 'board_relation')
        throw new ValidationError([
          { path: 'body.settings.relationColumnKey', message: 'Coluna de relação inexistente.' },
        ]);
    }
    if (
      type === 'rollup' &&
      value.source === 'subitems' &&
      byKey(value.targetColumnKey) === undefined
    )
      throw new ValidationError([
        { path: 'body.settings.targetColumnKey', message: 'Coluna de origem inexistente.' },
      ]);
    if (type === 'progress' && Array.isArray(value.sourceColumnKeys)) {
      for (const key of value.sourceColumnKeys) {
        if (byKey(key)?.type !== 'status')
          throw new ValidationError([
            { path: 'body.settings.sourceColumnKeys', message: 'Use colunas de status.' },
          ]);
      }
    }
    return value;
  }

  private validateRequiredWhen(
    definition: BoardDefinition,
    raw: FilterGroup | null,
    self: string,
  ): Record<string, unknown> | null {
    if (raw === null) return null;
    const parsed = FilterGroupSchema.safeParse(raw);
    if (!parsed.success)
      throw new ValidationError([{ path: 'body.requiredWhen', message: 'Condição inválida.' }]);
    for (const field of filterFields(parsed.data)) {
      if (field === self)
        throw new ValidationError([
          { path: 'body.requiredWhen', message: 'A condição não pode usar a própria coluna.' },
        ]);
      const known =
        definition.columns.some((column) => column.key === field) || /^[a-z_]+$/.test(field);
      if (!known)
        throw new ValidationError([
          { path: 'body.requiredWhen', message: `Campo desconhecido: ${field}` },
        ]);
    }
    return parsed.data as unknown as Record<string, unknown>;
  }

  private validateDefault(
    column: ColumnDefinition,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    if (
      !isColumnType(column.type) ||
      READ_ONLY_COLUMN_TYPES.has(column.type) ||
      column.binding !== null
    )
      throw new UnprocessableError('Esta coluna não aceita valor padrão.', 'default_unsupported');
    const parsed = COLUMN_TYPE_SPECS[column.type].value.safeParse(raw);
    if (!parsed.success)
      throw new ValidationError([
        { path: 'body.defaultValue', message: 'Valor padrão inválido para o tipo.' },
      ]);
    const value = parsed.data as Record<string, unknown>;
    if (column.type === 'status' && !column.labels.some((label) => label.id === value.labelId))
      throw new ValidationError([{ path: 'body.defaultValue', message: 'Rótulo inexistente.' }]);
    if (
      column.type === 'dropdown' &&
      (value.optionIds as string[]).some((id) => !column.options.some((option) => option.id === id))
    )
      throw new ValidationError([{ path: 'body.defaultValue', message: 'Opção inexistente.' }]);
    return value;
  }
}
