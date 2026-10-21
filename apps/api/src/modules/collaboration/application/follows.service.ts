import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId } from '@cube-track/shared';
import { and, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsRepository } from '../../work/infrastructure/items.repository.js';

const { follows, users } = schema;

/** Seguir/deixar de seguir um item para receber notificações (ADR 0048). */
@Injectable()
export class FollowsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly itemsRepository: ItemsRepository,
  ) {}

  private async itemOrThrow(itemId: string) {
    const item = await this.itemsRepository.findById(this.runner.tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    return item;
  }

  async status(user: AuthPrincipal, itemId: string): Promise<{ following: boolean; followers: { id: string; name: string; avatarUrl: string | null }[] }> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    const rows = await tx
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(follows)
      .innerJoin(users, eq(users.id, follows.userId))
      .where(and(eq(follows.entityType, 'item'), eq(follows.entityId, itemId)));
    return { following: rows.some((row) => row.id === user.userId), followers: rows };
  }

  async setFollowing(user: AuthPrincipal, itemId: string, following: boolean): Promise<void> {
    const item = await this.itemOrThrow(itemId);
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const tx = this.runner.tx;
    if (following) {
      await tx
        .insert(follows)
        .values({
          id: newId(),
          tenantId: user.tenantId,
          userId: user.userId,
          entityType: 'item',
          entityId: itemId,
          createdBy: user.userId,
        })
        .onConflictDoNothing({ target: [follows.tenantId, follows.userId, follows.entityType, follows.entityId] });
    } else {
      await tx
        .delete(follows)
        .where(
          and(
            eq(follows.userId, user.userId),
            eq(follows.entityType, 'item'),
            eq(follows.entityId, itemId),
          ),
        );
    }
  }
}
