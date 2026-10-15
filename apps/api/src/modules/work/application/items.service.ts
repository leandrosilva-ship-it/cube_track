import { Injectable } from '@nestjs/common';
import {
  COLUMN_TYPE_SPECS,
  READ_ONLY_COLUMN_TYPES,
  filterDepth,
  isColumnType,
  positionBetween,
  type FilterGroup,
  type ItemFieldChange,
  type Page,
  type SortTerm,
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
  assigneeIds,
  NATIVE_FIELD_BINDINGS,
  toItemDto,
  type ColumnVisibility,
  type ItemDto,
  type ItemRecord,
  type NativeField,
} from '../domain/item.js';
import { todayIn } from '../domain/board-definition.js';
import { BoardDefinitionRepository } from '../infrastructure/board-definition.repository.js';
import { ItemQueryBuilder } from '../infrastructure/item-query.js';
import { ItemsRepository, rowToItem } from '../infrastructure/items.repository.js';

export interface ListItemsQuery {
  filter: FilterGroup | null;
  sort: SortTerm[];
  limit: number;
  cursor: string | undefined;
  groupId: string | undefined;
  parentItemId: string | null;
  includeArchived: boolean;
}

export interface PositionInput {
  afterId?: string | undefined;
  beforeId?: string | undefined;
}

export interface CreateItemInput {
  groupId: string;
  name: string;
  parentItemId?: string | undefined;
  values?: Record<string, unknown> | undefined;
  fields?: Partial<Record<NativeField, string | null | undefined>> | undefined;
  position?: PositionInput | undefined;
}

export interface UpdateItemInput {
  name?: string | undefined;
  groupId?: string | undefined;
  position?: PositionInput | undefined;
  values?: Record<string, unknown> | undefined;
  fields?: Partial<Record<NativeField, string | null | undefined>> | undefined;
  /** Versões por campo lidas pelo cliente (atualização condicional, ADR 0008). */
  baseVersions?: Record<string, number> | undefined;
  /** Versão do item lida pelo cliente (atualização condicional do item inteiro). */
  expectedVersion?: number | undefined;
}

const NATIVE_COLUMNS: Record<NativeField, keyof typeof schema.items.$inferInsert> = {
  plannedStartDate: 'plannedStartDate',
  plannedEndDate: 'plannedEndDate',
  replannedStartDate: 'replannedStartDate',
  replannedEndDate: 'replannedEndDate',
  actualStartDate: 'actualStartDate',
  actualEndDate: 'actualEndDate',
  progress: 'progress',
};

/** Casos de uso de itens: leitura com redação por coluna, escrita com LWW por campo e eventos. */
@Injectable()
export class ItemsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly repository: ItemsRepository,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly definitions: BoardDefinitionRepository,
  ) {}

  // ------------------------------------------------------------------------------- leitura ---

  async visibility(
    user: AuthPrincipal,
    boardId: string,
  ): Promise<ColumnVisibility & { columns: BoardColumn[] }> {
    const { hidden, columns } = await this.access.hiddenColumns(user, boardId);
    const hiddenBindings = new Set(
      columns.flatMap((column) =>
        hidden.has(column.key) && column.binding !== null ? [column.binding] : [],
      ),
    );
    return { hidden, hiddenBindings, columns };
  }

  async list(user: AuthPrincipal, boardId: string, query: ListItemsQuery): Promise<Page<ItemDto>> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    if (query.filter !== null && filterDepth(query.filter) > 5) {
      throw new ValidationError([
        { path: 'query.filter', message: 'Filtro muito profundo (máximo 5 níveis).' },
      ]);
    }
    const board = await this.access.board(user, boardId);
    const principal = await this.access.principal(user);
    const visibility = await this.visibility(user, boardId);
    const compiled = new ItemQueryBuilder({
      boardId,
      columns: visibility.columns,
      hiddenColumnKeys: visibility.hidden,
      filter: query.filter,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
      groupId: query.groupId,
      parentItemId: query.parentItemId,
      includeArchived: query.includeArchived,
      currentUserId: user.userId,
      currentUserTeamIds: principal.teamIds,
      today: todayIn(await this.definitions.tenantTimezone(this.runner.tx, user.tenantId)),
      search: undefined,
      archivedOnly: false,
      withIndicators: false,
      assignedScope:
        board?.itemScope === 'assigned'
          ? { userId: user.userId, teamIds: principal.teamIds, peopleKeys: board.peopleColumnKeys }
          : null,
    }).build();
    const rows = await this.repository.runList(this.runner.tx, compiled.query);
    const page = rows.slice(0, compiled.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => toItemDto(rowToItem(row), visibility)),
      pageInfo: {
        hasNextPage: rows.length > compiled.limit,
        nextCursor:
          rows.length > compiled.limit && last !== undefined
            ? ItemQueryBuilder.nextCursor(last, compiled.signature, compiled.sortCount)
            : null,
      },
    };
  }

  async get(user: AuthPrincipal, itemId: string): Promise<ItemDto> {
    const item = await this.repository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    return toItemDto(item, await this.visibility(user, item.boardId));
  }

  // -------------------------------------------------------------------------------- escrita ---

  async create(user: AuthPrincipal, boardId: string, input: CreateItemInput): Promise<ItemDto> {
    const tx = this.runner.tx;
    await this.access.assert(user, 'item.create', { type: 'board', id: boardId }, 'Board');
    const group = await this.repository.findGroup(tx, input.groupId);
    if (group?.boardId !== boardId)
      throw new ValidationError([
        { path: 'body.groupId', message: 'Grupo não pertence ao board.' },
      ]);
    const parentItemId = input.parentItemId ?? null;
    if (parentItemId !== null) {
      const parent = await this.repository.findById(tx, parentItemId);
      if (parent?.boardId !== boardId)
        throw new ValidationError([{ path: 'body.parentItemId', message: 'Item pai inválido.' }]);
    }
    const visibility = await this.visibility(user, boardId);
    const values: Record<string, Record<string, unknown>> = {};
    const fieldVersions: Record<string, number> = {};
    for (const [key, raw] of Object.entries(input.values ?? {})) {
      if (raw === null) continue;
      const column = this.writableColumn(visibility.columns, key);
      await this.assertColumnWrite(user, boardId, column, undefined);
      values[key] = await this.validateValue(column, raw);
      fieldVersions[key] = 1;
    }
    const native: Partial<Record<NativeField, string | null>> = {};
    for (const [field, value] of Object.entries(input.fields ?? {}) as [
      NativeField,
      string | null | undefined,
    ][]) {
      if (value === undefined) continue;
      await this.assertNativeWrite(user, boardId, visibility.columns, field, undefined);
      native[field] = value;
      fieldVersions[field] = 1;
    }
    const position = await this.resolvePosition(input.groupId, parentItemId, input.position);
    const item = await this.repository.insert(tx, {
      tenantId: user.tenantId,
      boardId,
      groupId: input.groupId,
      parentItemId,
      name: input.name,
      position,
      values,
      fieldVersions,
      ...Object.fromEntries(
        Object.entries(native).map(([field, value]) => [
          NATIVE_COLUMNS[field as NativeField],
          value,
        ]),
      ),
      createdBy: user.userId,
      updatedBy: user.userId,
    });
    const peopleKeys = visibility.columns
      .filter((column) => column.type === 'people')
      .map((column) => column.key);
    this.events.recordChange({
      action: 'item.created',
      entityType: 'item',
      entityId: item.id,
      boardId,
      itemId: item.id,
      after: { name: item.name, groupId: item.groupId, values: item.values },
      activity: [{ action: 'item.created', newValue: { name: item.name, groupId: item.groupId } }],
    });
    const snapshot = toItemDto(item, { hidden: new Set(), hiddenBindings: new Set() });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'item.created',
      aggregateType: 'item',
      aggregateId: item.id,
      boardId,
      itemId: item.id,
      payload: {
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
          updatedAt: snapshot.updatedAt,
        },
      },
      routing: {
        assigneeIds: assigneeIds(item.values, peopleKeys),
        columnKeys: Object.keys(item.values),
      },
      actorId: user.userId,
    });
    return toItemDto(item, visibility);
  }

  async update(user: AuthPrincipal, itemId: string, input: UpdateItemInput): Promise<ItemDto> {
    const tx = this.runner.tx;
    const item = await this.repository.findById(tx, itemId, true);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    if (input.expectedVersion !== undefined && input.expectedVersion !== item.version) {
      throw new ConflictError('O item foi alterado por outra pessoa.', 'version_conflict', {
        currentVersion: item.version,
        current: toItemDto(item, await this.visibility(user, item.boardId)),
      });
    }
    const visibility = await this.visibility(user, item.boardId);
    const changes: ItemFieldChange[] = [];
    const activity: {
      action: string;
      columnKey?: string | null;
      oldValue?: unknown;
      newValue?: unknown;
    }[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const fieldVersions = { ...item.fieldVersions };
    const values = { ...item.values };
    const update: Partial<typeof schema.items.$inferInsert> = {};
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
          {
            field,
            currentVersion: current,
            current: toItemDto(item, visibility),
          },
        );
      }
    };

    if (input.name !== undefined && input.name !== item.name) {
      checkBase('name');
      before.name = item.name;
      after.name = input.name;
      update.name = input.name;
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
      const column = this.writableColumn(visibility.columns, key);
      await this.assertColumnWrite(user, item.boardId, column, item);
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
    if (input.values !== undefined) update.values = values;

    for (const [field, value] of Object.entries(input.fields ?? {}) as [
      NativeField,
      string | null | undefined,
    ][]) {
      if (value === undefined) continue;
      await this.assertNativeWrite(user, item.boardId, visibility.columns, field, item);
      checkBase(field);
      const previous = item[field];
      if (previous === value) continue;
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

    if (changes.length === 0) return toItemDto(item, visibility);
    const updated = await this.repository.update(tx, itemId, {
      ...update,
      fieldVersions,
      version: item.version + 1,
      updatedBy: user.userId,
    });
    const peopleKeys = visibility.columns
      .filter((column) => column.type === 'people')
      .map((column) => column.key);
    this.events.recordChange({
      action: 'item.updated',
      entityType: 'item',
      entityId: itemId,
      boardId: item.boardId,
      itemId,
      before,
      after,
      activity,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'item.updated',
      aggregateType: 'item',
      aggregateId: itemId,
      boardId: item.boardId,
      itemId,
      payload: { itemId, version: updated.version, changes },
      routing: {
        assigneeIds: [
          ...new Set([
            ...assigneeIds(item.values, peopleKeys),
            ...assigneeIds(updated.values, peopleKeys),
          ]),
        ],
        columnKeys: changes
          .filter((change) => change.kind === 'column')
          .map((change) => change.field),
        boundFields: changes
          .filter((change) => change.field in NATIVE_FIELD_BINDINGS)
          .map((change) => NATIVE_FIELD_BINDINGS[change.field as NativeField]),
      },
      actorId: user.userId,
    });
    return toItemDto(updated, visibility);
  }

  async remove(user: AuthPrincipal, itemId: string): Promise<void> {
    const tx = this.runner.tx;
    const item = await this.repository.findById(tx, itemId, true);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.delete', { type: 'item', item }, 'Item');
    await this.repository.update(tx, itemId, {
      deletedAt: new Date(),
      updatedBy: user.userId,
      version: item.version + 1,
    });
    const visibility = await this.visibility(user, item.boardId);
    const peopleKeys = visibility.columns
      .filter((column) => column.type === 'people')
      .map((column) => column.key);
    this.events.recordChange({
      action: 'item.deleted',
      entityType: 'item',
      entityId: itemId,
      boardId: item.boardId,
      itemId,
      before: { name: item.name, groupId: item.groupId },
      activity: [{ action: 'item.deleted', oldValue: { name: item.name } }],
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'item.deleted',
      aggregateType: 'item',
      aggregateId: itemId,
      boardId: item.boardId,
      itemId,
      payload: { itemId },
      routing: { assigneeIds: assigneeIds(item.values, peopleKeys) },
      actorId: user.userId,
    });
  }

  // ------------------------------------------------------------------------------ internos ---

  private writableColumn(columns: readonly BoardColumn[], key: string): BoardColumn {
    const column = columns.find((entry) => entry.key === key);
    if (column === undefined)
      throw new ValidationError([{ path: `body.values.${key}`, message: 'Coluna inexistente.' }]);
    if (column.binding !== null) {
      throw new UnprocessableError(
        `A coluna "${key}" é vinculada (${column.binding}); altere o campo de origem.`,
        'column_bound',
      );
    }
    if (isColumnType(column.type) && READ_ONLY_COLUMN_TYPES.has(column.type)) {
      throw new UnprocessableError(
        `A coluna "${key}" é calculada pelo sistema.`,
        'column_read_only',
      );
    }
    return column;
  }

  private async assertColumnWrite(
    user: AuthPrincipal,
    boardId: string,
    column: BoardColumn,
    item: ItemRecord | undefined,
  ): Promise<void> {
    const allowed = await this.access.can(user, 'column.update', {
      type: 'column',
      boardId,
      key: column.key,
      ...(item === undefined ? {} : { item: { id: item.id, values: item.values } }),
    });
    if (!allowed)
      throw new ForbiddenError(
        `Sem permissão para alterar a coluna "${column.key}".`,
        'column_forbidden',
        { column: column.key },
      );
  }

  /** Campos nativos herdam as restrições das colunas vinculadas a eles. */
  private async assertNativeWrite(
    user: AuthPrincipal,
    boardId: string,
    columns: readonly BoardColumn[],
    field: NativeField,
    item: ItemRecord | undefined,
  ): Promise<void> {
    for (const column of columns.filter(
      (entry) => entry.binding === NATIVE_FIELD_BINDINGS[field],
    )) {
      await this.assertColumnWrite(user, boardId, column, item);
    }
  }

  private async validateValue(column: BoardColumn, raw: unknown): Promise<Record<string, unknown>> {
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
        if (!(await this.repository.labelIds(tx, column.id)).has(value.labelId as string))
          fail('Rótulo de status inexistente.');
        break;
      case 'dropdown':
        if (
          missing(value.optionIds as string[], await this.repository.optionIds(tx, column.id))
            .length > 0
        )
          fail('Opção inexistente.');
        break;
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
        if (missing(itemIds, await this.repository.existingItems(tx, itemIds)).length > 0)
          fail('Item relacionado inexistente.');
        break;
      }
      default:
        break;
    }
    return value;
  }

  private async resolvePosition(
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
      return positionBetween(after, await this.repository.neighborAfter(tx, groupId, after));
    }
    if (input?.beforeId !== undefined) {
      const before = await reference(input.beforeId);
      return positionBetween(await this.repository.neighborBefore(tx, groupId, before), before);
    }
    return positionBetween(await this.repository.lastPosition(tx, groupId, parentItemId), null);
  }
}
