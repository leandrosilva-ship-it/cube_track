import { schema, type DatabaseHandle } from '@cube-track/db';
import type { EmailJob } from '@cube-track/shared';
import type { Queue } from 'bullmq';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { runAsSystem } from '../system-tx.js';

const { notifications, notificationPreferences, users } = schema;

export interface NotificationDigestOutcome {
  tenantId: string;
  userId: string;
  count: number;
}

interface DigestResult {
  email: EmailJob;
  count: number;
}

/**
 * Digest de notificações por e-mail (rotinas de manutenção `notification-digest-hourly`/`-daily`,
 * ADR 0051): `app.notification_digest_candidates()` devolve pares (tenant, usuário) cujo casamento
 * com a cadência é aproximado (não resolve a precedência "evento específico > `*`"); aqui, dentro da
 * transação do tenant, refaz-se a resolução exata — a mesma usada para decidir e-mail instantâneo em
 * `notifications.ts` — e só os tipos cuja preferência efetiva bate com `cadence` entram no resumo.
 * Notificações sem preferência customizada (padrão = instantâneo) nunca entram aqui: já foram
 * decididas no momento do envio original.
 */
export function createNotificationDigest(deps: {
  database: DatabaseHandle;
  redis: Redis;
  emails: Queue;
  appUrl: string;
  logger: Logger;
}) {
  return async function checkNotificationDigest(
    cadence: 'hourly' | 'daily',
  ): Promise<{ outcomes: NotificationDigestOutcome[] }> {
    const result = await deps.database.db.execute<{ tenant_id: string; user_id: string }>(
      sql`select * from app.notification_digest_candidates(${cadence}::text)`,
    );
    const windowKey =
      cadence === 'hourly'
        ? new Date().toISOString().slice(0, 13)
        : new Date().toISOString().slice(0, 10);
    const outcomes: NotificationDigestOutcome[] = [];

    for (const row of result.rows) {
      const digest = await runAsSystem(
        deps.database,
        deps.redis,
        row.tenant_id,
        {
          kind: 'system',
          causationId: null,
          depth: 0,
          correlationId: `notification-digest:${cadence}:${row.user_id}:${windowKey}`,
        },
        async (unit): Promise<DigestResult | null> => {
          const { tx } = unit;
          const [preferenceRows, pending] = await Promise.all([
            tx
              .select()
              .from(notificationPreferences)
              .where(
                and(
                  eq(notificationPreferences.userId, row.user_id),
                  eq(notificationPreferences.channel, 'email'),
                ),
              ),
            tx
              .select()
              .from(notifications)
              .where(
                and(
                  eq(notifications.userId, row.user_id),
                  isNull(notifications.emailSentAt),
                  isNull(notifications.readAt),
                ),
              )
              .orderBy(asc(notifications.createdAt)),
          ]);

          const kept = pending.filter((notification) => {
            const specific = preferenceRows.find((pref) => pref.eventType === notification.type);
            const fallback = preferenceRows.find((pref) => pref.eventType === '*');
            const effective = specific ?? fallback;
            return effective !== undefined && effective.enabled && effective.frequency === cadence;
          });
          if (kept.length === 0) return null;

          const [user] = await tx
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, row.user_id));
          if (user === undefined) return null;

          await tx
            .update(notifications)
            .set({ emailSentAt: new Date() })
            .where(
              inArray(
                notifications.id,
                kept.map((notification) => notification.id),
              ),
            );

          return {
            count: kept.length,
            email: {
              to: user.email,
              template: 'notification_digest',
              locale: 'pt-BR',
              data: {
                count: String(kept.length),
                items: kept.map((notification) => notification.title).join('\n'),
                link: `${deps.appUrl}/inbox`,
              },
            },
          };
        },
      );
      if (digest === null) continue;
      await deps.emails.add('notification_digest', digest.email, {
        jobId: `digest:${cadence}:${row.user_id}:${windowKey}`,
      });
      outcomes.push({ tenantId: row.tenant_id, userId: row.user_id, count: digest.count });
    }
    deps.logger.info(
      { cadence, sent: outcomes.length },
      'Digest de notificações por e-mail concluído',
    );
    return { outcomes };
  };
}
