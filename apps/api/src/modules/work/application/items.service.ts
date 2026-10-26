import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  Decimal,
  filterDepth,
  positionBetween,
  remapColumnValue,
  TRASH_RETENTION_DAYS,
  type FilterGroup,
  type MappableColumn,
  type Page,
  type SortTerm,
} from '@cube-track/shared';
import { and, asc, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import type { BoardColumn } from '../../access/infrastructure/access.repository.js';
import { todayIn, type BoardDefinition } from '../domain/board-definition.js';
import {
  assigneeIds,
  toItemDto,
  type ColumnVisibility,
  type ItemDto,
  type ItemIndicators,
  type ItemRecord,
} from '../domain/item.js';
import { BoardDefinitionRepository } from '../infrastructure/board-definition.repository.js';
import { ItemQueryBuilder } from '../infrastructure/item-query.js';
import { ItemsRepository, rowToItem } from '../infrastructure/items.repository.js';
import {
  ItemWriter,
  type CreateItemInput,
  type UpdateItemInput,
  type WriteContext,
} from './item-writer.js';

export type { CreateItemInput, PositionInput, UpdateItemInput } from './item-writer.js';

const { items, groups, itemReads, dependencies, memberships, users, teams, automations } = schema;

export interface ListItemsQuery {
  filter: FilterGroup | null;
  sort: SortTerm[];
  limit: number;
  cursor: string | undefined;
  groupId: string | undefined;
  parentItemId: string | null;
  includeArchived: boolean;
  search?: string | undefined;
  archivedOnly?: boolean | undefined;
  withIndicators?: boolean | undefined;
}

export type ItemAction =
  | { action: 'duplicate'; itemIds: string[]; includeSubitems?: boolean | undefined }
  | { action: 'archive' | 'unarchive' | 'delete' | 'restore'; itemIds: string[] }
  | {
      action: 'move';
      itemIds: string[];
      target: {
        boardId: string;
        groupId: string;
        /** Origem → destino (null = descartar). Obrigatório quando o board muda. */
        columnMapping?: Record<string, string | null> | undefined;
      };
    };

export interface DependencyInput {
  itemId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

const MAX_BULK = 500;

/** Casos de uso de itens: leitura com redação por coluna, escrita unitária/em massa e ações. */
@Injectable()
export class ItemsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly repository: ItemsRepository,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly definitions: BoardDefinitionRepository,
    private readonly writer: ItemWriter,
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
    const withIndicators = query.withIndicators ?? false;
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
      search: query.search,
      archivedOnly: query.archivedOnly ?? false,
      withIndicators,
      assignedScope:
        board?.itemScope === 'assigned'
          ? { userId: user.userId, teamIds: principal.teamIds, peopleKeys: board.peopleColumnKeys }
          : null,
    }).build();
    const rows = await this.repository.runList(this.runner.tx, compiled.query);
    const page = rows.slice(0, compiled.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) =>
        toItemDto(rowToItem(row), visibility, withIndicators ? indicatorsOf(row) : undefined),
      ),
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
      if (parent?.boardId !== boardId || parent.parentItemId !== null)
        throw new ValidationError([{ path: 'body.parentItemId', message: 'Item pai inválido.' }]);
      if (parent.groupId !== input.groupId)
        throw new ValidationError([
          { path: 'body.groupId', message: 'Subitem fica no grupo do item pai.' },
        ]);
    }
    const context = await this.writer.context(user, boardId, relatedIds(input.values));
    const position = await this.writer.resolvePosition(input.groupId, parentItemId, input.position);
    const item = await this.writer.insert(context, { ...input, position });
    await this.writer.emitCreated(context, item, 'created');
    return this.writer.dto(context, item);
  }

  async update(user: AuthPrincipal, itemId: string, input: UpdateItemInput): Promise<ItemDto> {
    const item = await this.lockedItem(itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const context = await this.writer.context(user, item.boardId, relatedIds(input.values));
    const { item: updated } = await this.writer.update(context, item, input);
    if (input.groupId !== undefined && input.groupId !== item.groupId)
      await this.moveChildrenToGroup(item.id, input.groupId);
    return this.writer.dto(context, updated);
  }

  /** Edição em massa (colar células, preencher abaixo, editar seleção): tudo ou nada. */
  async updateMany(
    user: AuthPrincipal,
    boardId: string,
    entries: (UpdateItemInput & { id: string })[],
  ): Promise<ItemDto[]> {
    if (entries.length > MAX_BULK)
      throw new ValidationError([
        { path: 'body.items', message: `Máximo de ${String(MAX_BULK)} itens.` },
      ]);
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const context = await this.writer.context(
      user,
      boardId,
      entries.flatMap((entry) => relatedIds(entry.values)),
    );
    const result: ItemDto[] = [];
    for (const [index, entry] of entries.entries()) {
      const item = await this.lockedItem(entry.id);
      if (item.boardId !== boardId)
        throw new ValidationError([
          { path: `body.items.${String(index)}.id`, message: 'Item de outro board.' },
        ]);
      await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
      const { item: updated } = await this.writer.update(context, item, entry);
      result.push(this.writer.dto(context, updated));
    }
    return result;
  }

  async remove(user: AuthPrincipal, itemId: string): Promise<void> {
    const item = await this.lockedItem(itemId);
    await this.runAction(user, item.boardId, { action: 'delete', itemIds: [itemId] });
  }

  // --------------------------------------------------------------------------------- ações ---

  /** Ações sobre uma seleção de itens do board (seleção múltipla da Tabela e do Kanban). */
  async runAction(
    user: AuthPrincipal,
    boardId: string,
    input: ItemAction,
  ): Promise<{ items: ItemDto[] }> {
    if (input.itemIds.length === 0 || input.itemIds.length > MAX_BULK)
      throw new ValidationError([
        { path: 'body.itemIds', message: `Entre 1 e ${String(MAX_BULK)} itens.` },
      ]);
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const context = await this.writer.context(user, boardId);
    const out: ItemDto[] = [];
    for (const itemId of [...new Set(input.itemIds)]) {
      const item = await this.repository.findAny(this.runner.tx, itemId);
      if (item?.boardId !== boardId) throw new NotFoundError('Item');
      switch (input.action) {
        case 'duplicate':
          out.push(await this.duplicate(context, item, input.includeSubitems ?? true));
          break;
        case 'archive':
        case 'unarchive':
          out.push(await this.setArchived(context, item, input.action === 'archive'));
          break;
        case 'delete':
          await this.softDelete(context, item);
          break;
        case 'restore':
          out.push(await this.restore(context, item));
          break;
        case 'move':
          out.push(await this.move(context, item, input.target));
          break;
      }
    }
    return { items: out };
  }

  /** Duplica itens do board para um grupo (duplicação de grupo). */
  async duplicateToGroup(
    user: AuthPrincipal,
    boardId: string,
    itemIds: string[],
    groupId: string,
  ): Promise<void> {
    if (itemIds.length === 0) return;
    const context = await this.writer.context(user, boardId);
    for (const itemId of itemIds) {
      const item = await this.repository.findAny(this.runner.tx, itemId);
      if (item?.boardId !== boardId) throw new NotFoundError('Item');
      await this.duplicate(context, item, true, groupId);
    }
  }

  private async duplicate(
    context: WriteContext,
    item: ItemRecord & { deletedAt: Date | null },
    includeSubitems: boolean,
    targetGroupId?: string,
  ): Promise<ItemDto> {
    if (item.deletedAt !== null) throw new NotFoundError('Item');
    await this.access.assert(
      context.user,
      'item.create',
      { type: 'board', id: context.boardId },
      'Board',
    );
    const tx = this.runner.tx;
    const groupId = targetGroupId ?? item.groupId;
    const position =
      targetGroupId === undefined
        ? positionBetween(
            item.position,
            await this.repository.neighborAfter(tx, item.groupId, item.position, item.parentItemId),
          )
        : positionBetween(await this.repository.lastPosition(tx, groupId, null), null);
    const copy = await this.writer.insert(
      context,
      {
        groupId,
        name: item.name,
        ...(item.parentItemId === null ? {} : { parentItemId: item.parentItemId }),
        position,
        fields: nativeOf(item),
        description: item.descriptionText,
        isMilestone: item.isMilestone,
        scheduleMode: item.scheduleMode,
      },
      {
        checkPermissions: false,
        enforceRequired: false,
        extraValues: copyableValues(context.definition, item.values),
      },
    );
    await this.writer.emitCreated(context, copy, 'duplicated');
    if (includeSubitems && item.parentItemId === null) {
      for (const child of await this.repository.children(tx, item.id)) {
        await this.writer.insert(
          context,
          {
            groupId: copy.groupId,
            name: child.name,
            parentItemId: copy.id,
            position: child.position,
            fields: nativeOf(child),
            description: child.descriptionText,
            isMilestone: child.isMilestone,
            scheduleMode: child.scheduleMode,
          },
          {
            checkPermissions: false,
            enforceRequired: false,
            extraValues: copyableValues(context.definition, child.values),
          },
        );
      }
    }
    return this.writer.dto(context, copy);
  }

  private async setArchived(
    context: WriteContext,
    item: ItemRecord & { deletedAt: Date | null },
    archived: boolean,
  ): Promise<ItemDto> {
    if (item.deletedAt !== null) throw new NotFoundError('Item');
    await this.access.assert(context.user, 'item.delete', { type: 'item', item }, 'Item');
    if ((item.archivedAt !== null) === archived) return this.writer.dto(context, item);
    const updated = await this.repository.update(this.runner.tx, item.id, {
      archivedAt: archived ? new Date() : null,
      version: item.version + 1,
      updatedBy: context.user.userId,
    });
    if (archived) await this.writer.emitRemoved(context, updated, 'archived');
    else await this.writer.emitCreated(context, updated, 'restored');
    return this.writer.dto(context, updated);
  }

  private async softDelete(
    context: WriteContext,
    item: ItemRecord & { deletedAt: Date | null },
  ): Promise<void> {
    if (item.deletedAt !== null) return;
    await this.access.assert(context.user, 'item.delete', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const deletedAt = new Date();
    const childIds = (await this.repository.children(tx, item.id)).map((child) => child.id);
    await this.repository.updateMany(tx, [item.id, ...childIds], {
      deletedAt,
      updatedBy: context.user.userId,
    });
    await this.writer.emitRemoved(context, item, 'deleted');
  }

  private async restore(
    context: WriteContext,
    item: ItemRecord & { deletedAt: Date | null },
  ): Promise<ItemDto> {
    if (item.deletedAt === null) return this.writer.dto(context, item);
    await this.access.assert(context.user, 'item.delete', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    if (item.deletedAt.getTime() < Date.now() - TRASH_RETENTION_DAYS * 86_400_000)
      throw new UnprocessableError('O prazo de restauração expirou.', 'trash_expired');
    if (item.parentItemId !== null) {
      const parent = await this.repository.findById(tx, item.parentItemId);
      if (parent === null)
        throw new UnprocessableError('Restaure primeiro o item pai.', 'parent_deleted');
    }
    // Grupo excluído: o item volta para o primeiro grupo ativo.
    let groupId = item.groupId;
    if ((await this.repository.findGroup(tx, groupId)) === null) {
      const [first] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(
          and(
            eq(groups.boardId, context.boardId),
            isNull(groups.deletedAt),
            isNull(groups.archivedAt),
          ),
        )
        .orderBy(asc(groups.position))
        .limit(1);
      if (first === undefined)
        throw new UnprocessableError('O board não tem grupos ativos.', 'no_group');
      groupId = first.id;
    }
    const childIds = (await this.repository.children(tx, item.id, item.deletedAt)).map(
      (child) => child.id,
    );
    await this.repository.updateMany(tx, childIds, { deletedAt: null, groupId });
    const position =
      groupId === item.groupId
        ? item.position
        : await this.writer.resolvePosition(groupId, item.parentItemId, undefined);
    const restored = await this.repository.update(tx, item.id, {
      deletedAt: null,
      groupId,
      position,
      version: item.version + 1,
      updatedBy: context.user.userId,
    });
    await this.writer.emitCreated(context, restored, 'restored');
    return this.writer.dto(context, restored);
  }

  /** Move para outro grupo (mesmo board) ou outro board, convertendo valores pelo mapeamento. */
  private async move(
    context: WriteContext,
    item: ItemRecord & { deletedAt: Date | null },
    target: Extract<ItemAction, { action: 'move' }>['target'],
  ): Promise<ItemDto> {
    if (item.deletedAt !== null) throw new NotFoundError('Item');
    if (item.parentItemId !== null)
      throw new UnprocessableError('Mova o item pai; subitens acompanham.', 'subitem_move');
    const tx = this.runner.tx;
    const group = await this.repository.findGroup(tx, target.groupId);
    if (group?.boardId !== target.boardId)
      throw new ValidationError([
        { path: 'body.target.groupId', message: 'Grupo não pertence ao board de destino.' },
      ]);
    if (target.boardId === context.boardId) {
      await this.access.assert(context.user, 'item.update', { type: 'item', item }, 'Item');
      const { item: updated } = await this.writer.update(context, item, {
        groupId: target.groupId,
      });
      await this.moveChildrenToGroup(item.id, target.groupId);
      return this.writer.dto(context, updated);
    }
    await this.access.assert(context.user, 'item.delete', { type: 'item', item }, 'Item');
    await this.access.assert(
      context.user,
      'item.create',
      { type: 'board', id: target.boardId },
      'Board',
    );
    const destination = await this.writer.context(context.user, target.boardId);
    const mapping = target.columnMapping ?? {};
    const directory = await this.directory();
    const remap = (values: Record<string, Record<string, unknown>>) => {
      const result: Record<string, Record<string, unknown>> = {};
      for (const [sourceKey, value] of Object.entries(values)) {
        const targetKey = mapping[sourceKey];
        if (targetKey === null || targetKey === undefined) continue;
        const source = context.definition.columns.find((column) => column.key === sourceKey);
        const targetColumn = destination.definition.columns.find(
          (column) => column.key === targetKey,
        );
        if (source === undefined || targetColumn === undefined) continue;
        const converted = remapColumnValue(
          asMappable(source),
          asMappable(targetColumn),
          value,
          directory,
        );
        if (converted !== null) result[targetKey] = converted;
      }
      return result;
    };
    const children = await this.repository.children(tx, item.id);
    const childIds = children.map((child) => child.id);
    // Desliga os subitens antes de trocar o board do pai (FK composta board + pai).
    await this.repository.updateMany(tx, childIds, { parentItemId: null });
    const position = positionBetween(
      await this.repository.lastPosition(tx, target.groupId, null),
      null,
    );
    const moved = await this.repository.update(tx, item.id, {
      boardId: target.boardId,
      groupId: target.groupId,
      position,
      values: remap(item.values),
      fieldVersions: {},
      version: item.version + 1,
      updatedBy: context.user.userId,
    });
    for (const child of children) {
      await this.repository.update(tx, child.id, {
        boardId: target.boardId,
        groupId: target.groupId,
        parentItemId: item.id,
        values: remap(child.values),
        fieldVersions: {},
        version: child.version + 1,
        updatedBy: context.user.userId,
      });
    }
    // Calculadas e conclusão no board de destino.
    const finalItem = await this.writer.recompute(destination, moved);
    await this.writer.emitRemoved(context, item, 'moved', {
      boardId: target.boardId,
      groupId: target.groupId,
    });
    await this.writer.emitCreated(destination, finalItem, 'moved', false);
    return this.writer.dto(destination, finalItem);
  }

  private async moveChildrenToGroup(parentId: string, groupId: string): Promise<void> {
    const childIds = (await this.repository.children(this.runner.tx, parentId)).map(
      (child) => child.id,
    );
    await this.repository.updateMany(this.runner.tx, childIds, { groupId });
  }

  // -------------------------------------------------------------------------------- lixeira ---

  /** Itens e grupos excluídos nos últimos 30 dias (restauráveis). */
  async trash(user: AuthPrincipal, boardId: string) {
    await this.access.assert(user, 'item.delete', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000);
    const deletedItems = await tx
      .select({
        id: items.id,
        name: items.name,
        groupId: items.groupId,
        groupName: groups.name,
        parentItemId: items.parentItemId,
        deletedAt: items.deletedAt,
        deletedBy: items.updatedBy,
      })
      .from(items)
      .innerJoin(groups, eq(groups.id, items.groupId))
      .where(
        and(eq(items.boardId, boardId), isNotNull(items.deletedAt), gte(items.deletedAt, cutoff)),
      )
      .orderBy(desc(items.deletedAt))
      .limit(1_000);
    // Subitens excluídos junto com o pai voltam com ele: listamos só os excluídos isoladamente.
    const parentDeleted = new Map(deletedItems.map((row) => [row.id, row.deletedAt?.getTime()]));
    const deletedGroups = await tx
      .select({
        id: groups.id,
        name: groups.name,
        color: groups.color,
        deletedAt: groups.deletedAt,
      })
      .from(groups)
      .where(
        and(
          eq(groups.boardId, boardId),
          isNotNull(groups.deletedAt),
          gte(groups.deletedAt, cutoff),
        ),
      )
      .orderBy(desc(groups.deletedAt));
    const expiresAt = (date: Date | null) =>
      date === null
        ? null
        : new Date(date.getTime() + TRASH_RETENTION_DAYS * 86_400_000).toISOString();
    return {
      items: deletedItems
        .filter(
          (row) =>
            row.parentItemId === null ||
            parentDeleted.get(row.parentItemId) !== row.deletedAt?.getTime(),
        )
        .map((row) => ({
          ...row,
          deletedAt: row.deletedAt?.toISOString() ?? null,
          expiresAt: expiresAt(row.deletedAt),
        })),
      groups: deletedGroups.map((row) => ({
        ...row,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        expiresAt: expiresAt(row.deletedAt),
      })),
    };
  }

  // ---------------------------------------------------------------------------- extras ---

  /** Marca as atualizações do item como vistas pelo usuário (indicador de não lidas). */
  async markSeen(user: AuthPrincipal, itemId: string): Promise<void> {
    const item = await this.repository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    await this.runner.tx
      .insert(itemReads)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        itemId,
        lastSeenAt: new Date(),
        createdBy: user.userId,
      })
      .onConflictDoUpdate({
        target: [itemReads.tenantId, itemReads.userId, itemReads.itemId],
        set: { lastSeenAt: sql`now()` },
      });
  }

  /** Cronômetro da coluna de tempo rastreado: iniciar soma no servidor (relógio confiável). */
  async timer(
    user: AuthPrincipal,
    itemId: string,
    columnKey: string,
    action: 'start' | 'stop',
  ): Promise<ItemDto> {
    const item = await this.lockedItem(itemId);
    const context = await this.writer.context(user, item.boardId);
    const column = this.writer.definitionColumn(context, columnKey);
    if (column.type !== 'time_tracking')
      throw new UnprocessableError('A coluna não é de tempo rastreado.', 'not_time_tracking');
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    await this.writer.assertColumnWrite(context, column, item);
    const current = (item.values[columnKey] ?? { n: '0' }) as { n?: string; runningSince?: string };
    const hours = current.n ?? '0';
    let next: Record<string, unknown>;
    if (action === 'start') {
      if (current.runningSince !== undefined) return this.writer.dto(context, item);
      next = { n: hours, runningSince: new Date().toISOString() };
    } else {
      if (current.runningSince === undefined) return this.writer.dto(context, item);
      const elapsedMs = Date.now() - new Date(current.runningSince).getTime();
      const total = new Decimal(hours).plus(new Decimal(elapsedMs).dividedBy(3_600_000));
      next = { n: total.toDecimalPlaces(4).toString() };
    }
    const { item: updated } = await this.writer.update(
      context,
      item,
      { values: { [columnKey]: next } },
      { checkPermissions: false, system: { keys: new Set([columnKey]) } },
    );
    return this.writer.dto(context, updated);
  }

  /**
   * Clique numa coluna `button` (ADR 0051): emite `item.button_clicked`, que o worker casa com a
   * automação `trigger.type: 'button_clicked'` cujo `config.columnKey` seja esta coluna.
   */
  async clickButton(user: AuthPrincipal, itemId: string, columnKey: string): Promise<void> {
    const item = await this.lockedItem(itemId);
    const context = await this.writer.context(user, item.boardId);
    const column = this.writer.definitionColumn(context, columnKey);
    if (column.type !== 'button')
      throw new UnprocessableError('A coluna não é um botão.', 'not_button');
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const automationId = column.settings.automationId;
    if (typeof automationId !== 'string')
      throw new UnprocessableError(
        'Este botão não tem uma automação configurada.',
        'button_without_automation',
      );
    const [automation] = await this.runner.tx
      .select({ trigger: automations.trigger })
      .from(automations)
      .where(and(eq(automations.id, automationId), isNull(automations.deletedAt)));
    const triggerConfig = automation?.trigger.config as { columnKey?: unknown } | undefined;
    if (automation?.trigger.type !== 'button_clicked' || triggerConfig?.columnKey !== columnKey) {
      throw new UnprocessableError(
        'A automação deste botão está desalinhada; reconfigure o botão.',
        'button_automation_mismatch',
      );
    }
    this.events.recordChange({
      action: 'item.button_clicked',
      entityType: 'item',
      entityId: item.id,
      boardId: item.boardId,
      after: { columnKey },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'item.button_clicked',
      aggregateType: 'item',
      aggregateId: item.id,
      boardId: item.boardId,
      itemId: item.id,
      payload: { itemId: item.id, columnKey },
      routing: { assigneeIds: assigneeIds(item.values, context.peopleKeys) },
      actorId: user.userId,
    });
  }

  async dependencies(user: AuthPrincipal, boardId: string) {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select({
        id: dependencies.id,
        predecessorId: dependencies.predecessorId,
        successorId: dependencies.successorId,
        type: dependencies.type,
        lagDays: dependencies.lagDays,
      })
      .from(dependencies)
      .where(eq(dependencies.boardId, boardId));
    return { data: rows };
  }

  /** Substitui os predecessores do item (coluna de dependência); recusa ciclos. */
  async setDependencies(
    user: AuthPrincipal,
    itemId: string,
    predecessors: DependencyInput[],
  ): Promise<void> {
    const tx = this.runner.tx;
    const item = await this.lockedItem(itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const ids = [...new Set(predecessors.map((entry) => entry.itemId))];
    if (ids.includes(itemId))
      throw new ValidationError([
        { path: 'body.predecessors', message: 'O item não pode depender de si mesmo.' },
      ]);
    const found = await this.repository.itemsOnBoards(tx, ids, [item.boardId]);
    if (ids.some((id) => !found.has(id)))
      throw new ValidationError([
        { path: 'body.predecessors', message: 'Predecessor fora do board.' },
      ]);
    const existing = await tx
      .select({ predecessorId: dependencies.predecessorId, successorId: dependencies.successorId })
      .from(dependencies)
      .where(eq(dependencies.boardId, item.boardId));
    const graph = new Map<string, string[]>();
    for (const edge of existing.filter((row) => row.successorId !== itemId)) {
      graph.set(edge.predecessorId, [...(graph.get(edge.predecessorId) ?? []), edge.successorId]);
    }
    for (const id of ids) graph.set(id, [...(graph.get(id) ?? []), itemId]);
    // Ciclo: a partir do item, chegar a algum predecessor.
    const reach = new Set<string>();
    const stack = [itemId];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      for (const nextNode of graph.get(node) ?? []) {
        if (ids.includes(nextNode) || nextNode === itemId)
          throw new UnprocessableError('A dependência criaria um ciclo.', 'dependency_cycle');
        if (!reach.has(nextNode)) {
          reach.add(nextNode);
          stack.push(nextNode);
        }
      }
    }
    const before = existing
      .filter((row) => row.successorId === itemId)
      .map((row) => row.predecessorId);
    await tx.delete(dependencies).where(eq(dependencies.successorId, itemId));
    if (predecessors.length > 0) {
      await tx.insert(dependencies).values(
        predecessors.map((entry) => ({
          tenantId: user.tenantId,
          boardId: item.boardId,
          predecessorId: entry.itemId,
          successorId: itemId,
          type: entry.type,
          lagDays: entry.lagDays,
          createdBy: user.userId,
        })),
      );
    }
    this.events.recordChange({
      action: 'item.dependencies_changed',
      entityType: 'item',
      entityId: itemId,
      boardId: item.boardId,
      itemId,
      before: { predecessors: before },
      after: { predecessors: ids },
      activity: [{ action: 'item.dependencies_changed', oldValue: before, newValue: ids }],
    });
    const version = (item.fieldVersions.dependencies ?? 0) + 1;
    await this.repository.update(tx, itemId, {
      fieldVersions: { ...item.fieldVersions, dependencies: version },
      version: item.version + 1,
      updatedBy: user.userId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'item.updated',
      aggregateType: 'item',
      aggregateId: itemId,
      boardId: item.boardId,
      itemId,
      payload: {
        itemId,
        version: item.version + 1,
        changes: [{ field: 'dependencies', kind: 'native', value: ids, version }],
      },
      actorId: user.userId,
    });
  }

  // ------------------------------------------------------------------------------ internos ---

  private async lockedItem(itemId: string): Promise<ItemRecord> {
    const item = await this.repository.findById(this.runner.tx, itemId, true);
    if (item === null) throw new NotFoundError('Item');
    return item;
  }

  /** Pessoas e times (conversão de valores entre tipos ao mover). */
  private async directory() {
    const tx = this.runner.tx;
    const people = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(isNull(memberships.deletedAt));
    const teamRows = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(isNull(teams.deletedAt));
    return { people, teams: teamRows };
  }
}

function indicatorsOf(row: Record<string, unknown>): ItemIndicators {
  return {
    subitems: Number(row.subitem_count ?? 0),
    attachments: Number(row.attachment_count ?? 0),
    updates: Number(row.update_count ?? 0),
    unreadUpdates: Number(row.unread_count ?? 0),
  };
}

/** Ids de itens relacionados nos valores (nomes para fórmulas que leem relações). */
function relatedIds(values: Record<string, unknown> | undefined): string[] {
  return Object.values(values ?? {}).flatMap((value) => {
    const ids = (value as { itemIds?: unknown } | null)?.itemIds;
    return Array.isArray(ids) ? ids.map(String) : [];
  });
}

function nativeOf(item: ItemRecord) {
  return {
    plannedStartDate: item.plannedStartDate,
    plannedEndDate: item.plannedEndDate,
    replannedStartDate: item.replannedStartDate,
    replannedEndDate: item.replannedEndDate,
    actualStartDate: item.actualStartDate,
    actualEndDate: item.actualEndDate,
    progress: item.progress,
  };
}

/** Valores copiados na duplicação: sem ID automático (novo número), arquivos e calculadas. */
function copyableValues(
  definition: BoardDefinition,
  values: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const skip = new Set(
    definition.columns
      .filter((column) =>
        ['auto_id', 'file', 'formula', 'progress', 'mirror', 'rollup'].includes(column.type),
      )
      .map((column) => column.key),
  );
  return Object.fromEntries(Object.entries(values).filter(([key]) => !skip.has(key)));
}

function asMappable(column: BoardDefinition['columns'][number]): MappableColumn {
  return {
    key: column.key,
    type: column.type,
    title: column.title,
    binding: column.binding,
    settings: column.settings,
    labels: column.labels,
    options: column.options,
  };
}
