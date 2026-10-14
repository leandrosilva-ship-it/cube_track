import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { decodeCursor, encodeCursor } from '@cube-track/shared';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import { addDays, weekStart } from '../domain/structure.js';

const { notifications, users, items, boards, groups } = schema;

const NOTIFICATION_SORT = 'createdAt:desc';
const WEEK_LIMIT = 200;

export interface NotificationQuery {
  limit: number;
  cursor?: string | undefined;
  unreadOnly?: boolean | undefined;
}

/** Caixa de entrada (notificações do usuário) e "Minha semana" (itens atribuídos com prazo). */
@Injectable()
export class InboxService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly itemsService: ItemsService,
    private readonly domainEvents: DomainEvents,
  ) {}

  async notifications(user: AuthPrincipal, query: NotificationQuery) {
    const tx = this.runner.tx;
    const conditions: SQL[] = [
      eq(notifications.userId, user.userId),
      isNull(notifications.archivedAt),
    ];
    if (query.unreadOnly === true) conditions.push(isNull(notifications.readAt));
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, NOTIFICATION_SORT);
      const createdAt = cursor?.keys[0];
      if (cursor === null || typeof createdAt !== 'string') {
        throw new ValidationError([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
      }
      const at = new Date(createdAt);
      const older = or(
        lt(notifications.createdAt, at),
        and(eq(notifications.createdAt, at), lt(notifications.id, cursor.id)),
      );
      if (older !== undefined) conditions.push(older);
    }
    const rows = await tx
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        boardId: notifications.boardId,
        itemId: notifications.itemId,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorId: notifications.actorId,
        actorName: users.name,
        actorAvatarUrl: users.avatarUrl,
      })
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const [unread] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.userId),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
        ),
      );
    return {
      data: page,
      unreadCount: unread?.count ?? 0,
      pageInfo: {
        hasNextPage: rows.length > query.limit,
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({
                sort: NOTIFICATION_SORT,
                keys: [last.createdAt.toISOString()],
                id: last.id,
              })
            : null,
      },
    };
  }

  /** Marca notificações como lidas (`ids` ausente = todas). */
  async markRead(user: AuthPrincipal, ids: readonly string[] | undefined) {
    const conditions: SQL[] = [eq(notifications.userId, user.userId), isNull(notifications.readAt)];
    if (ids !== undefined) conditions.push(inArray(notifications.id, [...ids]));
    const updated = await this.runner.tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(...conditions))
      .returning({ id: notifications.id });
    this.domainEvents.recordChange({
      action: 'notification.read',
      entityType: 'notification',
      entityId: updated.length === 1 ? (updated[0]?.id ?? null) : null,
      after: { count: updated.length, all: ids === undefined },
    });
    return { updated: updated.length };
  }

  /**
   * Itens atribuídos ao usuário (colunas de pessoas) com prazo na semana de `date`, mais os
   * atrasados não concluídos. O prazo é o término replanejado ou, sem ele, o planejado; se a coluna
   * vinculada ao prazo for oculta para o usuário, o item não aparece (mesma regra de leitura do REST).
   */
  async week(user: AuthPrincipal, date: string) {
    const from = weekStart(date);
    const to = addDays(from, 6);
    const readable = await this.access.readableBoards(user);
    const tx = this.runner.tx;
    const due = sql<string>`coalesce(${items.replannedEndDate}, ${items.plannedEndDate})`;
    const results: {
      id: string;
      name: string;
      boardId: string;
      boardName: string;
      workspaceId: string;
      groupName: string;
      dueDate: string;
      overdue: boolean;
    }[] = [];
    for (const board of readable) {
      if (results.length >= WEEK_LIMIT) break;
      const visibility = await this.itemsService.visibility(user, board.boardId);
      if (
        visibility.hiddenBindings.has('item.planned_end_date') ||
        visibility.hiddenBindings.has('item.replanned_end_date')
      ) {
        continue;
      }
      const peopleKeys = visibility.columns
        .filter((column) => column.type === 'people' && !visibility.hidden.has(column.key))
        .map((column) => column.key);
      if (peopleKeys.length === 0) continue;
      const assigned = or(
        ...peopleKeys.map(
          (key) =>
            sql`${items.values} -> ${key} -> 'personIds' @> ${JSON.stringify([user.userId])}::jsonb`,
        ),
      );
      if (assigned === undefined) continue;
      const rows = await tx
        .select({
          id: items.id,
          name: items.name,
          boardId: items.boardId,
          boardName: boards.name,
          workspaceId: boards.workspaceId,
          groupName: groups.name,
          dueDate: due,
          completedAt: items.completedAt,
        })
        .from(items)
        .innerJoin(boards, eq(boards.id, items.boardId))
        .innerJoin(groups, eq(groups.id, items.groupId))
        .where(
          and(
            eq(items.boardId, board.boardId),
            isNull(items.deletedAt),
            isNull(items.archivedAt),
            assigned,
            lte(due, to),
            or(gte(due, from), isNull(items.completedAt)),
          ),
        )
        .orderBy(due)
        .limit(WEEK_LIMIT - results.length);
      for (const row of rows) {
        results.push({
          id: row.id,
          name: row.name,
          boardId: row.boardId,
          boardName: row.boardName,
          workspaceId: row.workspaceId,
          groupName: row.groupName,
          dueDate: row.dueDate,
          overdue: row.dueDate < from && row.completedAt === null,
        });
      }
    }
    results.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
    return { from, to, data: results };
  }
}
