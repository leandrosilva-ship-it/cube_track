import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId } from '@cube-track/shared';
import { and, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';

const { notificationPreferences } = schema;

export interface UpdatePreferenceInput {
  channel: 'in_app' | 'email' | 'push';
  eventType: string;
  enabled: boolean;
  frequency: 'instant' | 'hourly' | 'daily' | 'never';
}

/**
 * Preferências de notificação do próprio usuário (canal × tipo de evento, `*` = padrão do canal).
 * Só `channel: 'email'` é consultado hoje pelo worker (instantâneo ou digest, ADR 0051); `in_app`/
 * `push` ficam armazenados para uso futuro sem efeito ainda.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly domainEvents: DomainEvents,
  ) {}

  async list(user: AuthPrincipal) {
    return this.runner.tx
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, user.tenantId),
          eq(notificationPreferences.userId, user.userId),
        ),
      );
  }

  async update(user: AuthPrincipal, entries: readonly UpdatePreferenceInput[]) {
    const tx = this.runner.tx;
    for (const entry of entries) {
      await tx
        .insert(notificationPreferences)
        .values({
          id: newId(),
          tenantId: user.tenantId,
          userId: user.userId,
          channel: entry.channel,
          eventType: entry.eventType,
          enabled: entry.enabled,
          frequency: entry.frequency,
          createdBy: user.userId,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.tenantId,
            notificationPreferences.userId,
            notificationPreferences.channel,
            notificationPreferences.eventType,
          ],
          set: { enabled: entry.enabled, frequency: entry.frequency },
        });
    }
    this.domainEvents.recordChange({
      action: 'notification_preference.update',
      entityType: 'notification_preference',
      entityId: user.userId,
      after: { entries },
    });
    return this.list(user);
  }
}
