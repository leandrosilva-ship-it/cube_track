import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  decodeCursor,
  docToPlainText,
  encodeCursor,
  extractMentions,
  isBlankDoc,
  newId,
  type MentionRef,
} from '@cube-track/shared';
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsRepository } from '../../work/infrastructure/items.repository.js';

const { updates, replies, reactions, mentions, users } = schema;

const FEED_SORT = 'createdAt:desc';
const MAX_LIMIT = 200;

export interface FeedQuery {
  limit: number;
  cursor?: string | undefined;
}

export interface ReactionSummaryEntry {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface UpdateDto {
  id: string;
  itemId: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: Record<string, unknown>;
  bodyText: string;
  isPinned: boolean;
  source: 'app' | 'email';
  editedAt: string | null;
  editCount: number;
  canEdit: boolean;
  createdAt: string;
  replyCount: number;
  reactions: ReactionSummaryEntry[];
}

export interface ReplyDto {
  id: string;
  updateId: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: Record<string, unknown>;
  bodyText: string;
  source: 'app' | 'email';
  editedAt: string | null;
  editCount: number;
  canEdit: boolean;
  createdAt: string;
  reactions: ReactionSummaryEntry[];
}

interface EditHistoryEntry {
  body: Record<string, unknown>;
  bodyText: string;
  editedAt: string;
}

/**
 * Feed de atualizações do item (ADR 0048): atualizações, respostas e reações, com extração de
 * @menções. A notificação (in-app + e-mail) e a indexação de busca já existem no worker, acionadas
 * pelos eventos `update.created`/`reply.created` emitidos aqui.
 */
@Injectable()
export class UpdatesService {
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

  // ------------------------------------------------------------------------------ leitura ---

  async listFeed(user: AuthPrincipal, itemId: string, query: FeedQuery) {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const limit = Math.min(query.limit, MAX_LIMIT);
    const conditions: SQL[] = [
      eq(updates.itemId, itemId),
      isNull(updates.deletedAt),
      eq(updates.isPinned, false),
    ];
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, FEED_SORT);
      if (cursor === null || typeof cursor.keys[0] !== 'string') {
        throw new ValidationError([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
      }
      const at = new Date(cursor.keys[0]);
      const older = or(
        lt(updates.createdAt, at),
        and(eq(updates.createdAt, at), lt(updates.id, cursor.id)),
      );
      if (older !== undefined) conditions.push(older);
    }
    const [pinnedRows, rows] = await Promise.all([
      tx
        .select({ update: updates, authorName: users.name, authorAvatarUrl: users.avatarUrl })
        .from(updates)
        .leftJoin(users, eq(users.id, updates.authorId))
        .where(and(eq(updates.itemId, itemId), isNull(updates.deletedAt), eq(updates.isPinned, true)))
        .orderBy(desc(updates.createdAt)),
      tx
        .select({ update: updates, authorName: users.name, authorAvatarUrl: users.avatarUrl })
        .from(updates)
        .leftJoin(users, eq(users.id, updates.authorId))
        .where(and(...conditions))
        .orderBy(desc(updates.createdAt), desc(updates.id))
        .limit(limit + 1),
    ]);
    const page = rows.slice(0, limit);
    const allRows = [...pinnedRows, ...page];
    const ids = allRows.map((row) => row.update.id);
    const [replyCounts, reactionMap] = await Promise.all([
      this.replyCounts(tx, ids),
      this.reactionSummary(tx, 'update', ids, user.userId),
    ]);
    const toDto = (row: (typeof allRows)[number]): UpdateDto => ({
      id: row.update.id,
      itemId: row.update.itemId,
      authorId: row.update.authorId,
      authorName: row.authorName,
      authorAvatarUrl: row.authorAvatarUrl,
      body: row.update.body,
      bodyText: row.update.bodyText,
      isPinned: row.update.isPinned,
      source: row.update.source,
      editedAt: row.update.editedAt?.toISOString() ?? null,
      editCount: (row.update.editHistory as EditHistoryEntry[]).length,
      canEdit: row.update.authorId === user.userId,
      createdAt: row.update.createdAt.toISOString(),
      replyCount: replyCounts.get(row.update.id) ?? 0,
      reactions: reactionMap.get(row.update.id) ?? [],
    });
    const last = page.at(-1);
    return {
      pinned: pinnedRows.map(toDto),
      data: page.map(toDto),
      pageInfo: {
        hasNextPage: rows.length > limit,
        nextCursor:
          rows.length > limit && last !== undefined
            ? encodeCursor({
                sort: FEED_SORT,
                keys: [last.update.createdAt.toISOString()],
                id: last.update.id,
              })
            : null,
      },
    };
  }

  async listReplies(user: AuthPrincipal, updateId: string): Promise<ReplyDto[]> {
    const update = await this.updateOrThrow(updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const rows = await tx
      .select({ reply: replies, authorName: users.name, authorAvatarUrl: users.avatarUrl })
      .from(replies)
      .leftJoin(users, eq(users.id, replies.authorId))
      .where(and(eq(replies.updateId, updateId), isNull(replies.deletedAt)))
      .orderBy(asc(replies.createdAt));
    const reactionMap = await this.reactionSummary(
      tx,
      'reply',
      rows.map((row) => row.reply.id),
      user.userId,
    );
    return rows.map((row) => ({
      id: row.reply.id,
      updateId: row.reply.updateId,
      authorId: row.reply.authorId,
      authorName: row.authorName,
      authorAvatarUrl: row.authorAvatarUrl,
      body: row.reply.body,
      bodyText: row.reply.bodyText,
      source: row.reply.source,
      editedAt: row.reply.editedAt?.toISOString() ?? null,
      editCount: (row.reply.editHistory as EditHistoryEntry[]).length,
      canEdit: row.reply.authorId === user.userId,
      createdAt: row.reply.createdAt.toISOString(),
      reactions: reactionMap.get(row.reply.id) ?? [],
    }));
  }

  // ------------------------------------------------------------------------------ escrita ---

  async createUpdate(
    user: AuthPrincipal,
    itemId: string,
    body: Record<string, unknown>,
    source: 'app' | 'email' = 'app',
  ): Promise<UpdateDto> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.comment', { type: 'item', item }, 'Item');
    if (isBlankDoc(body)) {
      throw new ValidationError([{ path: 'body.body', message: 'A atualização não pode ser vazia.' }]);
    }
    const id = newId();
    const bodyText = docToPlainText(body).slice(0, 10_000);
    await this.runner.tx.insert(updates).values({
      id,
      tenantId: user.tenantId,
      boardId: item.boardId,
      itemId,
      authorId: user.userId,
      body,
      bodyText,
      source,
      createdBy: user.userId,
    });
    await this.recordMentions(user, 'update', id, itemId, body);
    this.events.recordChange({
      action: 'update.create',
      entityType: 'update',
      entityId: id,
      boardId: item.boardId,
      itemId,
      after: { bodyText },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'update.created',
      aggregateType: 'update',
      aggregateId: id,
      boardId: item.boardId,
      itemId,
      payload: { updateId: id, itemId, authorId: user.userId, bodyText },
      actorId: user.userId,
    });
    return this.getUpdate(user, id);
  }

  async editUpdate(
    user: AuthPrincipal,
    updateId: string,
    body: Record<string, unknown>,
  ): Promise<UpdateDto> {
    const update = await this.updateOrThrow(updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.assertAuthorOrManager(user, item, update.authorId);
    if (isBlankDoc(body)) {
      throw new ValidationError([{ path: 'body.body', message: 'A atualização não pode ser vazia.' }]);
    }
    const bodyText = docToPlainText(body).slice(0, 10_000);
    const history = [
      ...(update.editHistory as EditHistoryEntry[]),
      { body: update.body, bodyText: update.bodyText, editedAt: new Date().toISOString() },
    ];
    await this.runner.tx
      .update(updates)
      .set({ body, bodyText, editedAt: new Date(), editHistory: history })
      .where(eq(updates.id, updateId));
    await this.recordMentions(user, 'update', updateId, update.itemId, body);
    this.events.recordChange({
      action: 'update.edit',
      entityType: 'update',
      entityId: updateId,
      boardId: item.boardId,
      itemId: update.itemId,
      before: { bodyText: update.bodyText },
      after: { bodyText },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'update.changed',
      aggregateType: 'update',
      aggregateId: updateId,
      boardId: item.boardId,
      itemId: update.itemId,
      payload: { updateId, itemId: update.itemId, change: 'edited' },
      actorId: user.userId,
    });
    return this.getUpdate(user, updateId);
  }

  async deleteUpdate(user: AuthPrincipal, updateId: string): Promise<void> {
    const update = await this.updateOrThrow(updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.assertAuthorOrManager(user, item, update.authorId);
    await this.runner.tx.update(updates).set({ deletedAt: new Date() }).where(eq(updates.id, updateId));
    this.events.recordChange({
      action: 'update.delete',
      entityType: 'update',
      entityId: updateId,
      boardId: item.boardId,
      itemId: update.itemId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'update.changed',
      aggregateType: 'update',
      aggregateId: updateId,
      boardId: item.boardId,
      itemId: update.itemId,
      payload: { updateId, itemId: update.itemId, change: 'deleted' },
      actorId: user.userId,
    });
  }

  async setPinned(user: AuthPrincipal, updateId: string, pinned: boolean): Promise<UpdateDto> {
    const update = await this.updateOrThrow(updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.access.assert(user, 'item.update', { type: 'item', item }, 'Item');
    await this.runner.tx
      .update(updates)
      .set({ isPinned: pinned })
      .where(eq(updates.id, updateId));
    this.events.recordChange({
      action: pinned ? 'update.pin' : 'update.unpin',
      entityType: 'update',
      entityId: updateId,
      boardId: item.boardId,
      itemId: update.itemId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'update.changed',
      aggregateType: 'update',
      aggregateId: updateId,
      boardId: item.boardId,
      itemId: update.itemId,
      payload: { updateId, itemId: update.itemId, change: pinned ? 'pinned' : 'unpinned' },
      actorId: user.userId,
    });
    return this.getUpdate(user, updateId);
  }

  async createReply(
    user: AuthPrincipal,
    updateId: string,
    body: Record<string, unknown>,
    source: 'app' | 'email' = 'app',
  ): Promise<ReplyDto> {
    const update = await this.updateOrThrow(updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.access.assert(user, 'item.comment', { type: 'item', item }, 'Item');
    if (isBlankDoc(body)) {
      throw new ValidationError([{ path: 'body.body', message: 'A resposta não pode ser vazia.' }]);
    }
    const id = newId();
    const bodyText = docToPlainText(body).slice(0, 10_000);
    await this.runner.tx.insert(replies).values({
      id,
      tenantId: user.tenantId,
      updateId,
      authorId: user.userId,
      body,
      bodyText,
      source,
      createdBy: user.userId,
    });
    await this.recordMentions(user, 'reply', id, update.itemId, body);
    this.events.recordChange({
      action: 'reply.create',
      entityType: 'reply',
      entityId: id,
      boardId: item.boardId,
      itemId: update.itemId,
      after: { bodyText },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'reply.created',
      aggregateType: 'reply',
      aggregateId: id,
      boardId: item.boardId,
      itemId: update.itemId,
      payload: { replyId: id, updateId, itemId: update.itemId, authorId: user.userId, bodyText },
      actorId: user.userId,
    });
    return this.getReply(user, id);
  }

  async editReply(
    user: AuthPrincipal,
    replyId: string,
    body: Record<string, unknown>,
  ): Promise<ReplyDto> {
    const reply = await this.replyOrThrow(replyId);
    const update = await this.updateOrThrow(reply.updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.assertAuthorOrManager(user, item, reply.authorId);
    if (isBlankDoc(body)) {
      throw new ValidationError([{ path: 'body.body', message: 'A resposta não pode ser vazia.' }]);
    }
    const bodyText = docToPlainText(body).slice(0, 10_000);
    const history = [
      ...(reply.editHistory as EditHistoryEntry[]),
      { body: reply.body, bodyText: reply.bodyText, editedAt: new Date().toISOString() },
    ];
    await this.runner.tx
      .update(replies)
      .set({ body, bodyText, editedAt: new Date(), editHistory: history })
      .where(eq(replies.id, replyId));
    await this.recordMentions(user, 'reply', replyId, update.itemId, body);
    this.events.recordChange({
      action: 'reply.edit',
      entityType: 'reply',
      entityId: replyId,
      boardId: item.boardId,
      itemId: update.itemId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'reply.changed',
      aggregateType: 'reply',
      aggregateId: replyId,
      boardId: item.boardId,
      itemId: update.itemId,
      payload: { replyId, updateId: update.id, itemId: update.itemId, change: 'edited' },
      actorId: user.userId,
    });
    return this.getReply(user, replyId);
  }

  async deleteReply(user: AuthPrincipal, replyId: string): Promise<void> {
    const reply = await this.replyOrThrow(replyId);
    const update = await this.updateOrThrow(reply.updateId);
    const item = await this.itemOrThrow(update.itemId);
    await this.assertAuthorOrManager(user, item, reply.authorId);
    await this.runner.tx.update(replies).set({ deletedAt: new Date() }).where(eq(replies.id, replyId));
    this.events.recordChange({
      action: 'reply.delete',
      entityType: 'reply',
      entityId: replyId,
      boardId: item.boardId,
      itemId: update.itemId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'reply.changed',
      aggregateType: 'reply',
      aggregateId: replyId,
      boardId: item.boardId,
      itemId: update.itemId,
      payload: { replyId, updateId: update.id, itemId: update.itemId, change: 'deleted' },
      actorId: user.userId,
    });
  }

  async toggleReaction(
    user: AuthPrincipal,
    targetType: 'update' | 'reply',
    targetId: string,
    emoji: string,
  ): Promise<ReactionSummaryEntry[]> {
    const { item, boardId, itemId } = await this.resolveTarget(targetType, targetId);
    await this.access.assert(user, 'item.comment', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const existing = await tx
      .select({ id: reactions.id })
      .from(reactions)
      .where(
        and(
          eq(reactions.targetType, targetType),
          eq(reactions.targetId, targetId),
          eq(reactions.userId, user.userId),
          eq(reactions.emoji, emoji),
        ),
      );
    const existingId = existing[0]?.id;
    if (existingId !== undefined) {
      await tx.delete(reactions).where(eq(reactions.id, existingId));
    } else {
      await tx.insert(reactions).values({
        id: newId(),
        tenantId: user.tenantId,
        targetType,
        targetId,
        userId: user.userId,
        emoji,
        createdBy: user.userId,
      });
    }
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'reaction.changed',
      aggregateType: targetType,
      aggregateId: targetId,
      boardId,
      itemId,
      payload: { targetType, targetId, itemId },
      actorId: user.userId,
    });
    const map = await this.reactionSummary(tx, targetType, [targetId], user.userId);
    return map.get(targetId) ?? [];
  }

  // ------------------------------------------------------------------------------- apoio ---

  private async getUpdate(user: AuthPrincipal, updateId: string): Promise<UpdateDto> {
    const feed = await this.listFeed(user, (await this.updateOrThrow(updateId)).itemId, {
      limit: MAX_LIMIT,
    });
    const found = [...feed.pinned, ...feed.data].find((entry) => entry.id === updateId);
    if (found === undefined) throw new NotFoundError('Atualização');
    return found;
  }

  private async getReply(user: AuthPrincipal, replyId: string): Promise<ReplyDto> {
    const reply = await this.replyOrThrow(replyId);
    const list = await this.listReplies(user, reply.updateId);
    const found = list.find((entry) => entry.id === replyId);
    if (found === undefined) throw new NotFoundError('Resposta');
    return found;
  }

  private async updateOrThrow(updateId: string) {
    const [row] = await this.runner.tx
      .select()
      .from(updates)
      .where(and(eq(updates.id, updateId), isNull(updates.deletedAt)));
    if (row === undefined) throw new NotFoundError('Atualização');
    return row;
  }

  private async replyOrThrow(replyId: string) {
    const [row] = await this.runner.tx
      .select()
      .from(replies)
      .where(and(eq(replies.id, replyId), isNull(replies.deletedAt)));
    if (row === undefined) throw new NotFoundError('Resposta');
    return row;
  }

  private async resolveTarget(targetType: 'update' | 'reply', targetId: string) {
    if (targetType === 'update') {
      const update = await this.updateOrThrow(targetId);
      const item = await this.itemOrThrow(update.itemId);
      return { item, boardId: item.boardId, itemId: item.id };
    }
    const reply = await this.replyOrThrow(targetId);
    const update = await this.updateOrThrow(reply.updateId);
    const item = await this.itemOrThrow(update.itemId);
    return { item, boardId: item.boardId, itemId: item.id };
  }

  private async assertAuthorOrManager(
    user: AuthPrincipal,
    item: { id: string; boardId: string; values: Readonly<Record<string, unknown>> },
    authorId: string | null,
  ): Promise<void> {
    if (authorId === user.userId) return;
    const canManage = await this.access.can(user, 'item.update', { type: 'item', item });
    if (!canManage) throw new ForbiddenError(undefined, 'forbidden', { action: 'item.comment.manage' });
  }

  private async replyCounts(
    tx: typeof this.runner.tx,
    updateIds: string[],
  ): Promise<Map<string, number>> {
    if (updateIds.length === 0) return new Map();
    const rows = await tx
      .select({ updateId: replies.updateId, count: sql<number>`count(*)::int` })
      .from(replies)
      .where(and(inArray(replies.updateId, updateIds), isNull(replies.deletedAt)))
      .groupBy(replies.updateId);
    return new Map(rows.map((row) => [row.updateId, row.count]));
  }

  private async reactionSummary(
    tx: typeof this.runner.tx,
    targetType: 'update' | 'reply',
    targetIds: string[],
    userId: string,
  ): Promise<Map<string, ReactionSummaryEntry[]>> {
    if (targetIds.length === 0) return new Map();
    const rows = await tx
      .select({
        targetId: reactions.targetId,
        emoji: reactions.emoji,
        count: sql<number>`count(*)::int`,
        reactedByMe: sql<boolean>`bool_or(${reactions.userId} = ${userId})`,
      })
      .from(reactions)
      .where(and(eq(reactions.targetType, targetType), inArray(reactions.targetId, targetIds)))
      .groupBy(reactions.targetId, reactions.emoji);
    const map = new Map<string, ReactionSummaryEntry[]>();
    for (const row of rows) {
      const list = map.get(row.targetId) ?? [];
      list.push({ emoji: row.emoji, count: row.count, reactedByMe: row.reactedByMe });
      map.set(row.targetId, list);
    }
    return map;
  }

  /**
   * Substitui as @menções extraídas do corpo (zera e regrava): numa edição isso mantém a tabela
   * fiel à versão atual, mas só a criação dispara notificação (o evento `*.created` é quem o
   * worker escuta — editar não renotifica quem já foi mencionado nem notifica novas menções).
   */
  private async recordMentions(
    user: AuthPrincipal,
    sourceType: 'update' | 'reply',
    sourceId: string,
    itemId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await this.runner.tx
      .delete(mentions)
      .where(and(eq(mentions.sourceType, sourceType), eq(mentions.sourceId, sourceId)));
    const refs: MentionRef[] = extractMentions(body);
    if (refs.length === 0) return;
    await this.runner.tx.insert(mentions).values(
      refs.map((ref) => ({
        id: newId(),
        tenantId: user.tenantId,
        sourceType,
        sourceId,
        itemId,
        targetType: ref.targetType,
        targetId: ref.targetId,
        createdBy: user.userId,
      })),
    );
  }
}
