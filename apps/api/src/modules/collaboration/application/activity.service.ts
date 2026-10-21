import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { decodeCursor, encodeCursor } from '@cube-track/shared';
import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsRepository } from '../../work/infrastructure/items.repository.js';

const { activityLogs, users } = schema;

const LOG_SORT = 'createdAt:desc';

export interface ActivityQuery {
  limit: number;
  cursor?: string | undefined;
  actorId?: string | undefined;
  columnKey?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** Log de atividade visível ao usuário no painel do item (ADR 0048), com filtros. */
@Injectable()
export class ActivityService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly itemsRepository: ItemsRepository,
  ) {}

  async list(user: AuthPrincipal, itemId: string, query: ActivityQuery) {
    const item = await this.itemsRepository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const conditions: SQL[] = [eq(activityLogs.itemId, itemId)];
    if (query.actorId !== undefined) conditions.push(eq(activityLogs.actorId, query.actorId));
    if (query.columnKey !== undefined) conditions.push(eq(activityLogs.columnKey, query.columnKey));
    if (query.from !== undefined) conditions.push(gte(activityLogs.createdAt, new Date(query.from)));
    if (query.to !== undefined) conditions.push(lte(activityLogs.createdAt, new Date(query.to)));
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor, LOG_SORT);
      if (cursor === null || typeof cursor.keys[0] !== 'string') {
        throw new ValidationError([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
      }
      const at = new Date(cursor.keys[0]);
      const older = or(
        lt(activityLogs.createdAt, at),
        and(eq(activityLogs.createdAt, at), lt(activityLogs.id, cursor.id)),
      );
      if (older !== undefined) conditions.push(older);
    }
    const rows = await tx
      .select({
        id: activityLogs.id,
        action: activityLogs.action,
        entityType: activityLogs.entityType,
        entityId: activityLogs.entityId,
        columnKey: activityLogs.columnKey,
        oldValue: activityLogs.oldValue,
        newValue: activityLogs.newValue,
        metadata: activityLogs.metadata,
        createdAt: activityLogs.createdAt,
        actorId: activityLogs.actorId,
        actorKind: activityLogs.actorKind,
        actorName: users.name,
        actorAvatarUrl: users.avatarUrl,
      })
      .from(activityLogs)
      .leftJoin(users, eq(users.id, activityLogs.actorId))
      .where(and(...conditions))
      .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      pageInfo: {
        hasNextPage: rows.length > query.limit,
        nextCursor:
          rows.length > query.limit && last !== undefined
            ? encodeCursor({ sort: LOG_SORT, keys: [last.createdAt.toISOString()], id: last.id })
            : null,
      },
    };
  }

  /** Autores distintos que já geraram atividade no item (para o filtro "por usuário"). */
  async actors(user: AuthPrincipal, itemId: string) {
    const item = await this.itemsRepository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    return this.runner.tx
      .selectDistinct({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(activityLogs)
      .innerJoin(users, eq(users.id, activityLogs.actorId))
      .where(eq(activityLogs.itemId, itemId));
  }
}
