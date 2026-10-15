import { Injectable } from '@nestjs/common';
import {
  COLUMN_TYPE_SPECS,
  isColumnType,
  missingRequiredColumns,
  positionBetween,
  READ_ONLY_COLUMN_TYPES,
  type ConditionContext,
  type ItemFieldChange,
} from '@cube-track/shared';
import type { schema } from '@cube-track/db';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import type { BoardColumn } from '../../access/infrastructure/access.repository.js';
import {
  isItemDone,
  toItemState,
  toRequirementColumns,
  type BoardDefinition,
  type ColumnDefinition,
} from '../domain/board-definition.js';
import {
  assigneeIds,
  NATIVE_FIELD_BINDINGS,
  toItemDto,
  type ColumnVisibility,
  type ItemDto,
  type ItemRecord,
  type NativeField,
} from '../domain/item.js';
import { BoardDefinitionRepository } from '../infrastructure/board-definition.repository.js';
import { ItemsRepository } from '../infrastructure/items.repository.js';
import { ComputedFieldsService, type PreparedCompute } from './computed-fields.service.js';

export interface PositionInput {
  afterId?: string | undefined;
  beforeId?: string | undefined;
}

export type NativeFieldsInput = Partial<Record<NativeField, string | null | undefined>>;

export interface CreateItemInput {
  groupId: string;
  name: string;
  parentItemId?: string | undefined;
  values?: Record<string, unknown> | undefined;
  fields?: NativeFieldsInput | undefined;
  position?: PositionInput | undefined;
}

export interface UpdateItemInput {
  name?: string | undefined;
  groupId?: string | undefined;
  position?: PositionInput | undefined;
  values?: Record<string, unknown> | undefined;
  fields?: NativeFieldsInput | undefined;
  /** Versões por campo lidas pelo cliente (atualização condicional, ADR 0008). */
  baseVersions?: Record<string, number> | undefined;
  /** Versão do item lida pelo cliente (atualização condicional do item inteiro). */
  expectedVersion?: number | undefined;
}

/** Contexto de escrita de um board, carregado uma vez por requisição (inclusive em massa). */
export interface WriteContext {
  user: AuthPrincipal;
  boardId: string;
  definition: BoardDefinition;
  visibility: ColumnVisibility & { columns: BoardColumn[] };
  peopleKeys: string[];
  prepared: PreparedCompute;
  conditions: ConditionContext;
}

export const NATIVE_COLUMNS: Record<NativeField, keyof typeof schema.items.$inferInsert> = {
  plannedStartDate: 'plannedStartDate',
  plannedEndDate: 'plannedEndDate',
  replannedStartDate: 'replannedStartDate',
  replannedEndDate: 'replannedEndDate',
  actualStartDate: 'actualStartDate',
  actualEndDate: 'actualEndDate',
  progress: 'progress',
};

/** Campos nativos em snake_case (chaves de `touched` e de condições). */
const NATIVE_SNAKE: Record<NativeField, string> = {
  plannedStartDate: 'planned_start_date',
  plannedEndDate: 'planned_end_date',
  replannedStartDate: 'replanned_start_date',
  replannedEndDate: 'replanned_end_date',
  actualStartDate: 'actual_start_date',
  actualEndDate: 'actual_end_date',
  progress: 'progress',
};

interface ActivityEntry {
  action: string;
  columnKey?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Resultado de uma atualização aplicada (o item e o que mudou, para eventos em lote). */
export interface AppliedUpdate {
  item: ItemRecord;
  changes: ItemFieldChange[];
}

/**
 * Núcleo de escrita de itens (ADR 0038/0039): validação por tipo, permissões por coluna, valores
 * padrão, obrigatoriedade (inclusive condicional), colunas calculadas do próprio item, conclusão
 * pelo status principal, LWW por campo, auditoria e eventos. Usado por criação, edição (unitária e
 * em massa), duplicação, movimentação e importação.
 */
@Injectable()
export class ItemWriter {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly repository: ItemsRepository,
    private readonly definitions: BoardDefinitionRepository,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly computed: ComputedFieldsService,
  ) {}

  // -------------------------------------------------------------------------------- contexto ---

  async context(
    user: AuthPrincipal,
    boardId: string,
    relatedItemIds: readonly string[] = [],
  ): Promise<WriteContext> {
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) throw new NotFoundError('Board');
    const { hidden, columns } = await this.access.hiddenColumns(user, boardId);
    const hiddenBindings = new Set(
      columns.flatMap((column) =>
        hidden.has(column.key) && column.binding !== null ? [column.binding] : [],
      ),
    );
    const principal = await this.access.principal(user);
    const prepared = await this.computed.prepare(user.tenantId, definition, relatedItemIds);
    return {
      user,
      boardId,
      definition,
      visibility: { hidden, hiddenBindings, columns },
      peopleKeys: definition.columns
        .filter((column) => column.type === 'people')
        .map((column) => column.key),
      prepared,
      conditions: {
        currentUserId: user.userId,
        currentUserTeamIds: principal.teamIds,
        today: prepared.today,
      },
    };
  }

  dto(context: WriteContext, item: ItemRecord): ItemDto {
    return toItemDto(item, context.visibility);
  }

  // -------------------------------------------------------------------------------- criação ---

  /**
   * Monta e insere um item: valores informados (com permissão), valores padrão das colunas,
   * obrigatoriedade, calculadas e conclusão. Não emite eventos (o chamador decide o motivo).
   */
  async insert(
    context: WriteContext,
    input: CreateItemInput & { position: string },
    options: {
      checkPermissions?: boolean;
      enforceRequired?: boolean;
      extraValues?: Record<string, Record<string, unknown>>;
    } = {},
  ): Promise<ItemRecord> {
    const tx = this.runner.tx;
    const checkPermissions = options.checkPermissions ?? true;
    const values: Record<string, Record<string, unknown>> = { ...(options.extraValues ?? {}) };
    const fieldVersions: Record<string, number> = {};
    for (const [key, raw] of Object.entries(input.values ?? {})) {
      if (raw === null) continue;
      const column = this.writableColumn(context, key);
      if (checkPermissions) await this.assertColumnWrite(context, column, undefined);
      values[key] = await this.validateValue(column, raw);
    }
    for (const column of context.definition.columns) {
      if (column.key in values || column.binding !== null || this.isReadOnly(column.type)) continue;
      if (column.defaultValue !== null) values[column.key] = column.defaultValue;
      else if (column.type === 'status' && typeof column.settings.defaultLabelId === 'string')
        values[column.key] = { labelId: column.settings.defaultLabelId };
    }
    const native: Partial<Record<NativeField, string | null>> = {};
    for (const [field, value] of Object.entries(input.fields ?? {}) as [
      NativeField,
      string | null | undefined,
    ][]) {
      if (value === undefined) continue;
      if (checkPermissions) await this.assertNativeWrite(context, field, undefined);
      native[field] = value;
    }
    const now = new Date();
    const draft = {
      id: '00000000-0000-7000-8000-000000000000',
      name: input.name,
      groupId: input.groupId,
      values,
      plannedStartDate: native.plannedStartDate ?? null,
      plannedEndDate: native.plannedEndDate ?? null,
      replannedStartDate: native.replannedStartDate ?? null,
      replannedEndDate: native.replannedEndDate ?? null,
      actualStartDate: native.actualStartDate ?? null,
      actualEndDate: native.actualEndDate ?? null,
      progress: native.progress ?? null,
      createdAt: now,
      updatedAt: now,
    };
    if ((options.enforceRequired ?? true) && input.parentItemId === undefined) {
      const missing = missingRequiredColumns(
        toRequirementColumns(context.definition),
        null,
        toItemState(context.definition, draft),
        new Set(Object.keys(values)),
        context.conditions,
      );
      this.assertNoMissing(missing);
    }
    for (const [key, value] of this.computed.compute(context.definition, context.prepared, draft)) {
      if (value === null) Reflect.deleteProperty(values, key);
      else values[key] = value;
    }
    for (const key of Object.keys(values)) fieldVersions[key] = 1;
    for (const field of Object.keys(native)) fieldVersions[field] = 1;
    return this.repository.insert(tx, {
      tenantId: context.user.tenantId,
      boardId: context.boardId,
      groupId: input.groupId,
      parentItemId: input.parentItemId ?? null,
      name: input.name,
      position: input.position,
      values,
      fieldVersions,
      ...Object.fromEntries(
        Object.entries(native).map(([field, value]) => [
          NATIVE_COLUMNS[field as NativeField],
          value,
        ]),
      ),
      completedAt: isItemDone(context.definition, values) ? now : null,
      createdBy: context.user.userId,
      updatedBy: context.user.userId,
    });
  }

  /** Auditoria + evento `item.created` para um item que passou a existir na lista do board. */
  async emitCreated(
    context: WriteContext,
    item: ItemRecord,
    reason: 'created' | 'duplicated' | 'restored' | 'moved' | 'imported',
    audit = true,
  ): Promise<void> {
    if (audit) {
      this.events.recordChange({
        action: `item.${reason === 'created' ? 'created' : reason}`,
        entityType: 'item',
        entityId: item.id,
        boardId: context.boardId,
        itemId: item.id,
        after: { name: item.name, groupId: item.groupId, values: item.values },
        activity: [
          {
            action: `item.${reason === 'created' ? 'created' : reason}`,
            newValue: { name: item.name, groupId: item.groupId },
          },
        ],
      });
    }
    const snapshot = toItemDto(item, { hidden: new Set(), hiddenBindings: new Set() });
    await this.events.emit({
      tenantId: context.user.tenantId,
      type: 'item.created',
      aggregateType: 'item',
      aggregateId: item.id,
      boardId: context.boardId,
      itemId: item.id,
      payload: {
        reason,
        item: {
          id: snapshot.id,
          boardId: snapshot.boardId,
          groupId: snapshot.groupId,
          parentItemId: snapshot.parentItemId,
          name: snapshot.name,
          position: snapshot.position,
          values: snapshot.values,
          version: snapshot.version,
          plannedStartDate: snapshot.plannedStartDate,
          plannedEndDate: snapshot.plannedEndDate,
          replannedStartDate: snapshot.replannedStartDate,
          replannedEndDate: snapshot.replannedEndDate,
          actualStartDate: snapshot.actualStartDate,
          actualEndDate: snapshot.actualEndDate,
          progress: snapshot.progress,
          createdAt: snapshot.createdAt,
          createdBy: snapshot.createdBy,
          updatedBy: snapshot.updatedBy,
          updatedAt: snapshot.updatedAt,
        },
      },
      routing: {
        assigneeIds: assigneeIds(item.values, context.peopleKeys),
        columnKeys: Object.keys(item.values),
      },
      actorId: context.user.userId,
    });
  }

  /** Evento `item.deleted` (lixeira, arquivo ou movido) com auditoria. */
  async emitRemoved(
    context: WriteContext,
    item: ItemRecord,
    reason: 'deleted' | 'archived' | 'moved',
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    this.events.recordChange({
      action: `item.${reason}`,
      entityType: 'item',
      entityId: item.id,
      boardId: context.boardId,
      itemId: item.id,
      before: { name: item.name, groupId: item.groupId },
      after: extra,
      activity: [{ action: `item.${reason}`, oldValue: { name: item.name }, newValue: extra }],
    });
    await this.events.emit({
      tenantId: context.user.tenantId,
      type: 'item.deleted',
      aggregateType: 'item',
      aggregateId: item.id,
      boardId: context.boardId,
      itemId: item.id,
      payload: { itemId: item.id, reason },
      routing: { assigneeIds: assigneeIds(item.values, context.peopleKeys) },
      actorId: context.user.userId,
    });
  }

  // -------------------------------------------------------------------------------- edição ---

  /**
   * Aplica uma atualização com LWW por campo, obrigatoriedade e recálculo; grava, audita e emite
   * `item.updated`. `system` permite escrever colunas somente leitura (cronômetro).
   */
  async update(
    context: WriteContext,
    item: ItemRecord,
    input: UpdateItemInput,
    options: { checkPermissions?: boolean; system?: { keys: ReadonlySet<string> } } = {},
  ): Promise<AppliedUpdate> {
    const tx = this.runner.tx;
    const checkPermissions = options.checkPermissions ?? true;
    if (input.expectedVersion !== undefined && input.expectedVersion !== item.version) {
      throw new ConflictError('O item foi alterado por outra pessoa.', 'version_conflict', {
        currentVersion: item.version,
        current: this.dto(context, item),
      });
    }
    const changes: ItemFieldChange[] = [];
    const activity: ActivityEntry[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const fieldVersions = { ...item.fieldVersions };
    const values = { ...item.values };
    const update: Partial<typeof schema.items.$inferInsert> = {};
    const touched = new Set<string>();
    const bump = (field: string) => {
      fieldVersions[field] = (fieldVersions[field] ?? 0) + 1;
      return fieldVersions[field];
    };
    const checkBase = (field: string) => {
      const base = input.baseVersions?.[field];
      const current = item.fieldVersions[field] ?? 0;
      if (base !== undefined && base !== current) {
        throw new ConflictError(
          `O campo "${field}" foi alterado por outra pessoa.`,
          'field_version_conflict',
          { field, currentVersion: current, current: this.dto(context, item) },
        );
      }
    };

    if (input.name !== undefined && input.name !== item.name) {
      checkBase('name');
      before.name = item.name;
      after.name = input.name;
      update.name = input.name;
      touched.add('name');
      changes.push({ field: 'name', kind: 'native', value: input.name, version: bump('name') });
      activity.push({
        action: 'item.renamed',
        columnKey: 'name',
        oldValue: item.name,
        newValue: input.name,
      });
    }

    let groupId = item.groupId;
    if (input.groupId !== undefined && input.groupId !== item.groupId) {
      const group = await this.repository.findGroup(tx, input.groupId);
      if (group?.boardId !== item.boardId)
        throw new ValidationError([
          { path: 'body.groupId', message: 'Grupo não pertence ao board.' },
        ]);
      checkBase('group_id');
      groupId = input.groupId;
      before.groupId = item.groupId;
      after.groupId = groupId;
      update.groupId = groupId;
      touched.add('group_id');
      changes.push({
        field: 'group_id',
        kind: 'native',
        value: groupId,
        version: bump('group_id'),
      });
      activity.push({
        action: 'item.moved',
        columnKey: 'group_id',
        oldValue: item.groupId,
        newValue: groupId,
      });
    }
    if (input.position !== undefined || update.groupId !== undefined) {
      const position = await this.resolvePosition(groupId, item.parentItemId, input.position);
      update.position = position;
      changes.push({
        field: 'position',
        kind: 'native',
        value: position,
        version: bump('position'),
      });
    }

    for (const [key, raw] of Object.entries(input.values ?? {})) {
      const system = options.system?.keys.has(key) === true;
      const column = system ? this.systemColumn(context, key) : this.writableColumn(context, key);
      if (checkPermissions && !system) await this.assertColumnWrite(context, column, item);
      checkBase(key);
      const previous = item.values[key] ?? null;
      if (raw === null) {
        if (!(key in values)) continue;
        Reflect.deleteProperty(values, key);
      } else {
        values[key] = await this.validateValue(column, raw);
      }
      const next = values[key] ?? null;
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      touched.add(key);
      before[key] = previous;
      after[key] = next;
      changes.push({ field: key, kind: 'column', value: next, version: bump(key) });
      activity.push({
        action: 'item.value_changed',
        columnKey: key,
        oldValue: previous,
        newValue: next,
      });
    }

    const native: Partial<Record<NativeField, string | null>> = {};
    for (const [field, value] of Object.entries(input.fields ?? {}) as [
      NativeField,
      string | null | undefined,
    ][]) {
      if (value === undefined) continue;
      if (checkPermissions) await this.assertNativeWrite(context, field, item);
      checkBase(field);
      const previous = item[field];
      if (previous === value) continue;
      native[field] = value;
      touched.add(NATIVE_SNAKE[field]);
      before[field] = previous;
      after[field] = value;
      (update as Record<string, unknown>)[NATIVE_COLUMNS[field]] = value;
      changes.push({ field, kind: 'native', value, version: bump(field) });
      activity.push({
        action: 'item.value_changed',
        columnKey: field,
        oldValue: previous,
        newValue: value,
      });
    }

    if (changes.length === 0) return { item, changes };

    const nextSnapshot = { ...item, ...native, name: update.name ?? item.name, groupId, values };
    if (item.parentItemId === null) {
      const missing = missingRequiredColumns(
        toRequirementColumns(context.definition),
        toItemState(context.definition, item),
        toItemState(context.definition, nextSnapshot),
        touched,
        context.conditions,
      );
      this.assertNoMissing(missing);
    }

    for (const [key, value] of this.computed.compute(
      context.definition,
      context.prepared,
      nextSnapshot,
    )) {
      const previous = item.values[key] ?? null;
      if (value === null) Reflect.deleteProperty(values, key);
      else values[key] = value;
      changes.push({ field: key, kind: 'column', value, version: bump(key) });
      before[key] = previous;
      after[key] = value;
    }
    if (Object.keys(values).length > 0 || input.values !== undefined) update.values = values;

    const wasDone = item.completedAt !== null;
    const isDone = isItemDone(context.definition, values);
    if (wasDone !== isDone) update.completedAt = isDone ? new Date() : null;

    const updated = await this.repository.update(tx, item.id, {
      ...update,
      fieldVersions,
      version: item.version + 1,
      updatedBy: context.user.userId,
    });
    this.events.recordChange({
      action: 'item.updated',
      entityType: 'item',
      entityId: item.id,
      boardId: item.boardId,
      itemId: item.id,
      before,
      after,
      activity,
    });
    await this.events.emit({
      tenantId: context.user.tenantId,
      type: 'item.updated',
      aggregateType: 'item',
      aggregateId: item.id,
      boardId: item.boardId,
      itemId: item.id,
      payload: { itemId: item.id, version: updated.version, changes },
      routing: {
        assigneeIds: [
          ...new Set([
            ...assigneeIds(item.values, context.peopleKeys),
            ...assigneeIds(updated.values, context.peopleKeys),
          ]),
        ],
        columnKeys: changes
          .filter((change) => change.kind === 'column')
          .map((change) => change.field),
        boundFields: changes
          .filter((change) => change.field in NATIVE_FIELD_BINDINGS)
          .map((change) => NATIVE_FIELD_BINDINGS[change.field as NativeField]),
      },
      actorId: context.user.userId,
    });
    return { item: updated, changes };
  }

  /**
   * Recalcula as colunas calculadas do item (ex.: após mover para outro board) e grava sem emitir
   * eventos — o chamador publica o estado final.
   */
  async recompute(context: WriteContext, item: ItemRecord): Promise<ItemRecord> {
    const changes = this.computed.compute(context.definition, context.prepared, item);
    if (changes.size === 0) return item;
    const values = { ...item.values };
    const fieldVersions = { ...item.fieldVersions };
    for (const [key, value] of changes) {
      if (value === null) Reflect.deleteProperty(values, key);
      else values[key] = value;
      fieldVersions[key] = (fieldVersions[key] ?? 0) + 1;
    }
    return this.repository.update(this.runner.tx, item.id, {
      values,
      fieldVersions,
      completedAt: isItemDone(context.definition, values) ? (item.completedAt ?? new Date()) : null,
    });
  }

  // ------------------------------------------------------------------------------- posições ---

  async resolvePosition(
    groupId: string,
    parentItemId: string | null,
    input: PositionInput | undefined,
  ): Promise<string> {
    const tx = this.runner.tx;
    const reference = async (id: string) => {
      const item = await this.repository.findById(tx, id);
      if (item?.groupId !== groupId)
        throw new ValidationError([
          { path: 'body.position', message: 'Item de referência fora do grupo.' },
        ]);
      return item.position;
    };
    if (input?.afterId !== undefined) {
      const after = await reference(input.afterId);
      return positionBetween(
        after,
        await this.repository.neighborAfter(tx, groupId, after, parentItemId),
      );
    }
    if (input?.beforeId !== undefined) {
      const before = await reference(input.beforeId);
      return positionBetween(
        await this.repository.neighborBefore(tx, groupId, before, parentItemId),
        before,
      );
    }
    return positionBetween(await this.repository.lastPosition(tx, groupId, parentItemId), null);
  }

  // ------------------------------------------------------------------------------ validações ---

  private isReadOnly(type: string): boolean {
    return isColumnType(type) && READ_ONLY_COLUMN_TYPES.has(type);
  }

  private assertNoMissing(missing: readonly { key: string; title: string }[]): void {
    if (missing.length === 0) return;
    throw new UnprocessableError(
      `Preencha os campos obrigatórios: ${missing.map((column) => column.title).join(', ')}.`,
      'required_fields_missing',
      { fields: missing.map((column) => ({ key: column.key, title: column.title })) },
    );
  }

  definitionColumn(context: WriteContext, key: string): ColumnDefinition {
    const column = context.definition.columns.find((entry) => entry.key === key);
    if (column === undefined)
      throw new ValidationError([{ path: `body.values.${key}`, message: 'Coluna inexistente.' }]);
    return column;
  }

  private systemColumn(context: WriteContext, key: string): ColumnDefinition {
    return this.definitionColumn(context, key);
  }

  writableColumn(context: WriteContext, key: string): ColumnDefinition {
    const column = this.definitionColumn(context, key);
    if (column.binding !== null) {
      throw new UnprocessableError(
        `A coluna "${key}" é vinculada (${column.binding}); altere o campo de origem.`,
        'column_bound',
      );
    }
    if (this.isReadOnly(column.type)) {
      throw new UnprocessableError(
        `A coluna "${key}" é calculada pelo sistema.`,
        'column_read_only',
      );
    }
    return column;
  }

  async assertColumnWrite(
    context: WriteContext,
    column: { key: string },
    item: ItemRecord | undefined,
  ): Promise<void> {
    const allowed = await this.access.can(context.user, 'column.update', {
      type: 'column',
      boardId: context.boardId,
      key: column.key,
      ...(item === undefined ? {} : { item: { id: item.id, values: item.values } }),
    });
    if (!allowed)
      throw new ForbiddenError(
        `Sem permissão para alterar a coluna "${column.key}".`,
        'column_forbidden',
        {
          column: column.key,
        },
      );
  }

  /** Campos nativos herdam as restrições das colunas vinculadas a eles. */
  private async assertNativeWrite(
    context: WriteContext,
    field: NativeField,
    item: ItemRecord | undefined,
  ): Promise<void> {
    for (const column of context.visibility.columns.filter(
      (entry) => entry.binding === NATIVE_FIELD_BINDINGS[field],
    )) {
      await this.assertColumnWrite(context, column, item);
    }
  }

  async validateValue(column: ColumnDefinition, raw: unknown): Promise<Record<string, unknown>> {
    if (!isColumnType(column.type))
      throw new UnprocessableError(`Tipo de coluna desconhecido: ${column.type}`);
    const parsed = COLUMN_TYPE_SPECS[column.type].value.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          path: ['body', 'values', column.key, ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }
    const value = parsed.data as Record<string, unknown>;
    const tx = this.runner.tx;
    const missing = (ids: readonly string[], existing: Set<string>) =>
      ids.filter((id) => !existing.has(id));
    const fail = (message: string) => {
      throw new ValidationError([{ path: `body.values.${column.key}`, message }]);
    };
    switch (column.type) {
      case 'status':
        if (!column.labels.some((label) => label.id === value.labelId))
          fail('Rótulo de status inexistente.');
        break;
      case 'dropdown': {
        const optionIds = value.optionIds as string[];
        if (optionIds.some((id) => !column.options.some((option) => option.id === id)))
          fail('Opção inexistente.');
        if (column.settings.multiple !== true && optionIds.length > 1)
          fail('Esta coluna aceita uma única opção.');
        break;
      }
      case 'people': {
        const personIds = value.personIds as string[];
        const teamIds = value.teamIds as string[];
        if (missing(personIds, await this.repository.existingMembers(tx, personIds)).length > 0)
          fail('Pessoa não pertence à organização.');
        if (missing(teamIds, await this.repository.existingTeams(tx, teamIds)).length > 0)
          fail('Time inexistente.');
        break;
      }
      case 'board_relation': {
        const itemIds = value.itemIds as string[];
        const boardIds = Array.isArray(column.settings.boardIds)
          ? (column.settings.boardIds as string[])
          : [];
        const found = await this.repository.itemsOnBoards(tx, itemIds, boardIds);
        if (missing(itemIds, found).length > 0)
          fail('Item relacionado inexistente ou fora dos boards configurados.');
        if (column.settings.allowMultiple === false && itemIds.length > 1)
          fail('Esta coluna aceita um único item relacionado.');
        break;
      }
      case 'rating': {
        const max = typeof column.settings.max === 'number' ? column.settings.max : 5;
        if (Number(value.n) > max || Number(value.n) < 0)
          fail(`Avaliação entre 0 e ${String(max)}.`);
        break;
      }
      default:
        break;
    }
    return value;
  }
}
