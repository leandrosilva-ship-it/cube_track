import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, positionBetween, TRASH_RETENTION_DAYS } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsService } from './items.service.js';

const { groups, items } = schema;

type GroupRow = typeof groups.$inferSelect;

export interface GroupPositionInput {
  afterId?: string | undefined;
  beforeId?: string | undefined;
}

export interface UpdateGroupInput {
  name?: string | undefined;
  color?: string | undefined;
  isCollapsed?: boolean | undefined;
  archived?: boolean | undefined;
  position?: GroupPositionInput | undefined;
}

type GroupChange = 'created' | 'updated' | 'deleted' | 'archived' | 'restored' | 'moved';

/** Grupos do board: criação, edição, ordem, duplicação, movimentação, arquivo e lixeira. */
@Injectable()
export class GroupsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly items: ItemsService,
  ) {}

  async create(
    user: AuthPrincipal,
    boardId: string,
    input: { name: string; color?: string | undefined; position?: GroupPositionInput | undefined },
  ) {
    await this.assertManage(user, boardId);
    const id = newId();
    const position = await this.position(boardId, input.position, null);
    await this.runner.tx.insert(groups).values({
      id,
      tenantId: user.tenantId,
      boardId,
      name: input.name,
      color: input.color ?? '#579bfc',
      position,
      createdBy: user.userId,
    });
    await this.changed(user, boardId, id, 'created', null, {
      name: input.name,
      color: input.color ?? '#579bfc',
      position,
    });
    return { id, name: input.name, color: input.color ?? '#579bfc', position, isCollapsed: false };
  }

  async update(user: AuthPrincipal, groupId: string, input: UpdateGroupInput) {
    const group = await this.row(groupId);
    await this.assertManage(user, group.boardId);
    const set: Partial<typeof groups.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.color !== undefined) set.color = input.color;
    if (input.isCollapsed !== undefined) set.isCollapsed = input.isCollapsed;
    if (input.position !== undefined)
      set.position = await this.position(group.boardId, input.position, groupId);
    if (input.archived !== undefined && input.archived !== (group.archivedAt !== null)) {
      if (input.archived) await this.assertNotLast(group);
      set.archivedAt = input.archived ? new Date() : null;
    }
    if (Object.keys(set).length === 0) return this.summary(group);
    const [updated] = await this.runner.tx
      .update(groups)
      .set(set)
      .where(eq(groups.id, groupId))
      .returning();
    if (updated === undefined) throw new NotFoundError('Grupo');
    const before = Object.fromEntries(
      Object.keys(set).map((key) => [key, (group as Record<string, unknown>)[key]]),
    );
    const change: GroupChange =
      set.archivedAt === undefined ? 'updated' : set.archivedAt === null ? 'restored' : 'archived';
    await this.changed(user, group.boardId, groupId, change, before, set);
    return this.summary(updated);
  }

  /** Duplica o grupo logo abaixo do original, com itens e subitens (sem IDs automáticos). */
  async duplicate(user: AuthPrincipal, groupId: string, includeItems: boolean) {
    const group = await this.row(groupId);
    await this.assertManage(user, group.boardId);
    const tx = this.runner.tx;
    const created = await this.create(user, group.boardId, {
      name: group.name,
      color: group.color,
      position: { afterId: groupId },
    });
    if (includeItems) {
      const rows = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.groupId, groupId),
            isNull(items.parentItemId),
            isNull(items.deletedAt),
            isNull(items.archivedAt),
          ),
        )
        .orderBy(asc(items.position));
      await this.items.duplicateToGroup(
        user,
        group.boardId,
        rows.map((row) => row.id),
        created.id,
      );
    }
    return created;
  }

  /** Move o grupo (e seus itens) para outro board, convertendo valores pelo mapeamento. */
  async move(
    user: AuthPrincipal,
    groupId: string,
    target: { boardId: string; columnMapping: Record<string, string | null> },
  ) {
    const group = await this.row(groupId);
    if (target.boardId === group.boardId)
      throw new ValidationError([{ path: 'body.boardId', message: 'Escolha outro board.' }]);
    await this.assertManage(user, group.boardId);
    await this.assertManage(user, target.boardId);
    await this.assertNotLast(group);
    const created = await this.create(user, target.boardId, {
      name: group.name,
      color: group.color,
    });
    const rows = await this.runner.tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.groupId, groupId), isNull(items.parentItemId), isNull(items.deletedAt)))
      .orderBy(asc(items.position));
    if (rows.length > 0) {
      await this.items.runAction(user, group.boardId, {
        action: 'move',
        itemIds: rows.map((row) => row.id),
        target: {
          boardId: target.boardId,
          groupId: created.id,
          columnMapping: target.columnMapping,
        },
      });
    }
    await this.runner.tx
      .update(groups)
      .set({ deletedAt: new Date() })
      .where(eq(groups.id, groupId));
    await this.changed(
      user,
      group.boardId,
      groupId,
      'moved',
      { boardId: group.boardId },
      { boardId: target.boardId, groupId: created.id },
    );
    return created;
  }

  /** Exclui o grupo e seus itens (lixeira por 30 dias). */
  async remove(user: AuthPrincipal, groupId: string): Promise<void> {
    const group = await this.row(groupId);
    await this.assertManage(user, group.boardId);
    await this.assertNotLast(group);
    const deletedAt = new Date();
    await this.runner.tx.update(groups).set({ deletedAt }).where(eq(groups.id, groupId));
    await this.runner.tx
      .update(items)
      .set({ deletedAt, updatedBy: user.userId })
      .where(and(eq(items.groupId, groupId), isNull(items.deletedAt)));
    await this.changed(
      user,
      group.boardId,
      groupId,
      'deleted',
      { name: group.name },
      { deletedAt: deletedAt.toISOString() },
    );
  }

  /** Restaura grupo da lixeira com os itens excluídos junto com ele. */
  async restore(user: AuthPrincipal, groupId: string) {
    const [group] = await this.runner.tx.select().from(groups).where(eq(groups.id, groupId));
    if (group?.deletedAt === null || group?.deletedAt === undefined)
      throw new NotFoundError('Grupo');
    await this.assertManage(user, group.boardId);
    if (group.deletedAt.getTime() < Date.now() - TRASH_RETENTION_DAYS * 86_400_000)
      throw new UnprocessableError('O prazo de restauração expirou.', 'trash_expired');
    await this.runner.tx.update(groups).set({ deletedAt: null }).where(eq(groups.id, groupId));
    await this.runner.tx
      .update(items)
      .set({ deletedAt: null })
      .where(and(eq(items.groupId, groupId), eq(items.deletedAt, group.deletedAt)));
    await this.changed(
      user,
      group.boardId,
      groupId,
      'restored',
      { deletedAt: group.deletedAt.toISOString() },
      { deletedAt: null },
    );
    return this.summary({ ...group, deletedAt: null });
  }

  // ------------------------------------------------------------------------------ internos ---

  private summary(group: GroupRow) {
    return {
      id: group.id,
      name: group.name,
      color: group.color,
      position: group.position,
      isCollapsed: group.isCollapsed,
      archivedAt: group.archivedAt?.toISOString() ?? null,
    };
  }

  private async assertManage(user: AuthPrincipal, boardId: string): Promise<void> {
    await this.access.assert(user, 'group.manage', { type: 'board', id: boardId }, 'Board');
  }

  private async row(groupId: string): Promise<GroupRow> {
    const [group] = await this.runner.tx
      .select()
      .from(groups)
      .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
      .for('update');
    if (group === undefined) throw new NotFoundError('Grupo');
    return group;
  }

  private async assertNotLast(group: GroupRow): Promise<void> {
    const active = await this.runner.tx
      .select({ id: groups.id })
      .from(groups)
      .where(
        and(eq(groups.boardId, group.boardId), isNull(groups.deletedAt), isNull(groups.archivedAt)),
      );
    if (active.filter((row) => row.id !== group.id).length === 0)
      throw new UnprocessableError('O board precisa de ao menos um grupo ativo.', 'last_group');
  }

  private async position(
    boardId: string,
    input: GroupPositionInput | undefined,
    self: string | null,
  ): Promise<string> {
    const rows = (
      await this.runner.tx
        .select({ id: groups.id, position: groups.position })
        .from(groups)
        .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
        .orderBy(asc(groups.position))
    ).filter((row) => row.id !== self);
    const indexOf = (id: string) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1)
        throw new ValidationError([
          { path: 'body.position', message: 'Grupo de referência inexistente.' },
        ]);
      return index;
    };
    if (input?.afterId !== undefined) {
      const index = indexOf(input.afterId);
      return positionBetween(rows[index]?.position ?? null, rows[index + 1]?.position ?? null);
    }
    if (input?.beforeId !== undefined) {
      const index = indexOf(input.beforeId);
      return positionBetween(rows[index - 1]?.position ?? null, rows[index]?.position ?? null);
    }
    return positionBetween(rows.at(-1)?.position ?? null, null);
  }

  private async changed(
    user: AuthPrincipal,
    boardId: string,
    groupId: string,
    change: GroupChange,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    this.events.recordChange({
      action: `group.${change}`,
      entityType: 'group',
      entityId: groupId,
      boardId,
      before,
      after,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'group.changed',
      aggregateType: 'group',
      aggregateId: groupId,
      boardId,
      payload: {
        groupId,
        change,
        changes: JSON.parse(JSON.stringify(after)) as Record<string, unknown>,
      },
      actorId: user.userId,
    });
  }
}
