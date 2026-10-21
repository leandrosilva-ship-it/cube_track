import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, positionBetween } from '@cube-track/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsRepository } from '../../work/infrastructure/items.repository.js';

const { checklists, checklistItems } = schema;

export interface ChecklistItemDto {
  id: string;
  content: string;
  isDone: boolean;
  doneAt: string | null;
  doneBy: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  position: string;
}

export interface ChecklistDto {
  id: string;
  itemId: string;
  title: string;
  position: string;
  items: ChecklistItemDto[];
  progress: { done: number; total: number };
}

function toItemDto(row: typeof checklistItems.$inferSelect): ChecklistItemDto {
  return {
    id: row.id,
    content: row.content,
    isDone: row.isDone,
    doneAt: row.doneAt?.toISOString() ?? null,
    doneBy: row.doneBy,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate,
    position: row.position,
  };
}

/** Checklists do item (e subitens), com progresso calculado (ADR 0048). */
@Injectable()
export class ChecklistsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly itemsRepository: ItemsRepository,
    private readonly events: DomainEvents,
  ) {}

  private async itemOrThrow(itemId: string) {
    const item = await this.itemsRepository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    return item;
  }

  async list(user: AuthPrincipal, itemId: string): Promise<ChecklistDto[]> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const lists = await tx
      .select()
      .from(checklists)
      .where(and(eq(checklists.itemId, itemId), isNull(checklists.deletedAt)))
      .orderBy(asc(checklists.position));
    const byChecklist = new Map<string, ChecklistItemDto[]>();
    if (lists.length > 0) {
      const items = await tx
        .select()
        .from(checklistItems)
        .where(
          and(
            inArray(
              checklistItems.checklistId,
              lists.map((list) => list.id),
            ),
            isNull(checklistItems.deletedAt),
          ),
        )
        .orderBy(asc(checklistItems.position));
      for (const row of items) {
        const dto = toItemDto(row);
        const list = byChecklist.get(row.checklistId) ?? [];
        list.push(dto);
        byChecklist.set(row.checklistId, list);
      }
    }
    return lists.map((list) => {
      const entries = byChecklist.get(list.id) ?? [];
      return {
        id: list.id,
        itemId: list.itemId,
        title: list.title,
        position: list.position,
        items: entries,
        progress: { done: entries.filter((entry) => entry.isDone).length, total: entries.length },
      };
    });
  }

  async createChecklist(user: AuthPrincipal, itemId: string, title: string): Promise<ChecklistDto> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const siblings = await tx
      .select({ position: checklists.position })
      .from(checklists)
      .where(and(eq(checklists.itemId, itemId), isNull(checklists.deletedAt)))
      .orderBy(asc(checklists.position));
    const id = newId();
    const position = positionBetween(siblings.at(-1)?.position ?? null, null);
    await tx.insert(checklists).values({
      id,
      tenantId: user.tenantId,
      itemId,
      title,
      position,
      createdBy: user.userId,
    });
    await this.notifyChanged(user, item, id);
    return { id, itemId, title, position, items: [], progress: { done: 0, total: 0 } };
  }

  async renameChecklist(user: AuthPrincipal, checklistId: string, title: string): Promise<void> {
    const checklist = await this.checklistOrThrow(checklistId);
    const item = await this.itemOrThrow(checklist.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    await this.runner.tx.update(checklists).set({ title }).where(eq(checklists.id, checklistId));
    await this.notifyChanged(user, item, checklistId);
  }

  async deleteChecklist(user: AuthPrincipal, checklistId: string): Promise<void> {
    const checklist = await this.checklistOrThrow(checklistId);
    const item = await this.itemOrThrow(checklist.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    await this.runner.tx
      .update(checklists)
      .set({ deletedAt: new Date() })
      .where(eq(checklists.id, checklistId));
    await this.notifyChanged(user, item, checklistId);
  }

  async addItem(
    user: AuthPrincipal,
    checklistId: string,
    input: { content: string; assigneeId?: string | null | undefined; dueDate?: string | null | undefined },
  ): Promise<ChecklistItemDto> {
    const checklist = await this.checklistOrThrow(checklistId);
    const item = await this.itemOrThrow(checklist.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const siblings = await tx
      .select({ position: checklistItems.position })
      .from(checklistItems)
      .where(and(eq(checklistItems.checklistId, checklistId), isNull(checklistItems.deletedAt)))
      .orderBy(asc(checklistItems.position));
    const id = newId();
    const position = positionBetween(siblings.at(-1)?.position ?? null, null);
    await tx.insert(checklistItems).values({
      id,
      tenantId: user.tenantId,
      checklistId,
      content: input.content,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      position,
      createdBy: user.userId,
    });
    await this.notifyChanged(user, item, checklistId);
    return {
      id,
      content: input.content,
      isDone: false,
      doneAt: null,
      doneBy: null,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      position,
    };
  }

  async updateItem(
    user: AuthPrincipal,
    itemRowId: string,
    input: {
      content?: string | undefined;
      isDone?: boolean | undefined;
      assigneeId?: string | null | undefined;
      dueDate?: string | null | undefined;
    },
  ): Promise<void> {
    const row = await this.itemRowOrThrow(itemRowId);
    const checklist = await this.checklistOrThrow(row.checklistId);
    const item = await this.itemOrThrow(checklist.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    const set: Partial<typeof checklistItems.$inferInsert> = {};
    if (input.content !== undefined) set.content = input.content;
    if (input.assigneeId !== undefined) set.assigneeId = input.assigneeId;
    if (input.dueDate !== undefined) set.dueDate = input.dueDate;
    if (input.isDone !== undefined && input.isDone !== row.isDone) {
      set.isDone = input.isDone;
      set.doneAt = input.isDone ? new Date() : null;
      set.doneBy = input.isDone ? user.userId : null;
    }
    if (Object.keys(set).length === 0) return;
    await this.runner.tx.update(checklistItems).set(set).where(eq(checklistItems.id, itemRowId));
    if (set.isDone !== undefined) {
      this.events.recordChange({
        action: 'checklist_item.toggle',
        entityType: 'checklist_item',
        entityId: itemRowId,
        boardId: item.boardId,
        itemId: item.id,
        before: { isDone: row.isDone },
        after: { isDone: set.isDone },
        activity: [
          {
            action: 'checklist_item.toggle',
            oldValue: { isDone: row.isDone, content: row.content },
            newValue: { isDone: set.isDone, content: input.content ?? row.content },
          },
        ],
      });
    }
    await this.notifyChanged(user, item, checklist.id);
  }

  async deleteItem(user: AuthPrincipal, itemRowId: string): Promise<void> {
    const row = await this.itemRowOrThrow(itemRowId);
    const checklist = await this.checklistOrThrow(row.checklistId);
    const item = await this.itemOrThrow(checklist.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    await this.runner.tx
      .update(checklistItems)
      .set({ deletedAt: new Date() })
      .where(eq(checklistItems.id, itemRowId));
    await this.notifyChanged(user, item, checklist.id);
  }

  private async checklistOrThrow(checklistId: string) {
    const [row] = await this.runner.tx
      .select()
      .from(checklists)
      .where(and(eq(checklists.id, checklistId), isNull(checklists.deletedAt)));
    if (row === undefined) throw new NotFoundError('Checklist');
    return row;
  }

  private async itemRowOrThrow(itemRowId: string) {
    const [row] = await this.runner.tx
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.id, itemRowId), isNull(checklistItems.deletedAt)));
    if (row === undefined) throw new NotFoundError('Item do checklist');
    return row;
  }

  private async notifyChanged(
    user: AuthPrincipal,
    item: { id: string; boardId: string },
    checklistId: string,
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'checklist.changed',
      aggregateType: 'checklist',
      aggregateId: checklistId,
      boardId: item.boardId,
      itemId: item.id,
      payload: { itemId: item.id, checklistId },
      actorId: user.userId,
    });
  }
}
