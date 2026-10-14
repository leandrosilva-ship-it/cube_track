import { schema, type DatabaseHandle } from '@cube-track/db';
import { DomainEventJobSchema, type EmailJob } from '@cube-track/shared';
import type { Job, Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { runAsSystem } from '../system-tx.js';

const { mentions, notifications, notificationPreferences, teamMembers, items, users, follows } =
  schema;

/**
 * Notificações de menção (`update.created`): resolve usuários mencionados (diretos, times e
 * "todos" = seguidores do board), cria a notificação in-app, emite `notification.created` para a
 * room do usuário e envia e-mail imediato conforme a preferência.
 */
export function notificationsProcessor(deps: {
  database: DatabaseHandle;
  redis: Redis;
  emails: Queue;
  appUrl: string;
}) {
  return async (job: Job) => {
    const event = DomainEventJobSchema.parse(job.data);
    if (event.type !== 'update.created' || event.itemId === null || event.boardId === null)
      return { notified: 0 };
    const updateId = typeof event.payload.updateId === 'string' ? event.payload.updateId : '';
    const bodyText = typeof event.payload.bodyText === 'string' ? event.payload.bodyText : '';
    const boardId = event.boardId;
    const itemId = event.itemId;
    const emailJobs: EmailJob[] = [];

    const notified = await runAsSystem(
      deps.database,
      deps.redis,
      event.tenantId,
      {
        kind: 'system',
        causationId: event.eventId,
        depth: event.depth,
        correlationId: event.eventId,
      },
      async (unit) => {
        const rows = await unit.tx
          .select()
          .from(mentions)
          .where(and(eq(mentions.sourceType, 'update'), eq(mentions.sourceId, updateId)));
        const recipients = new Set<string>();
        for (const mention of rows) {
          if (mention.targetType === 'user' && mention.targetId !== null)
            recipients.add(mention.targetId);
          if (mention.targetType === 'team' && mention.targetId !== null) {
            const members = await unit.tx
              .select({ userId: teamMembers.userId })
              .from(teamMembers)
              .where(eq(teamMembers.teamId, mention.targetId));
            members.forEach((member) => recipients.add(member.userId));
          }
          if (mention.targetType === 'everyone') {
            const followers = await unit.tx
              .select({ userId: follows.userId })
              .from(follows)
              .where(and(eq(follows.entityType, 'board'), eq(follows.entityId, boardId)));
            followers.forEach((follower) => recipients.add(follower.userId));
          }
        }
        if (event.actorId !== null) recipients.delete(event.actorId);
        if (recipients.size === 0) return 0;

        const [item] = await unit.tx
          .select({ name: items.name })
          .from(items)
          .where(eq(items.id, itemId));
        const [actor] =
          event.actorId === null
            ? [undefined]
            : await unit.tx
                .select({ name: users.name })
                .from(users)
                .where(eq(users.id, event.actorId));
        const actorName = actor?.name ?? 'Alguém';
        const title = `${actorName} mencionou você em "${item?.name ?? 'um item'}"`;
        const recipientList = [...recipients];
        const people = await unit.tx
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, recipientList));
        const preferences = await unit.tx
          .select()
          .from(notificationPreferences)
          .where(
            and(
              inArray(notificationPreferences.userId, recipientList),
              eq(notificationPreferences.channel, 'email'),
            ),
          );

        for (const userId of recipientList) {
          const [created] = await unit.tx
            .insert(notifications)
            .values({
              tenantId: event.tenantId,
              userId,
              type: 'mention',
              title,
              body: bodyText.slice(0, 280),
              actorId: event.actorId,
              boardId,
              itemId,
              entityType: 'update',
              entityId: updateId,
            })
            .returning({ id: notifications.id });
          if (created === undefined) continue;
          await unit.emit({
            type: 'notification.created',
            aggregateType: 'notification',
            aggregateId: created.id,
            userId,
            payload: { notificationId: created.id, type: 'mention', title, itemId, boardId },
          });
          const userPreferences = preferences.filter((preference) => preference.userId === userId);
          const specific = userPreferences.find((preference) => preference.eventType === 'mention');
          const fallback = userPreferences.find((preference) => preference.eventType === '*');
          const effective = specific ?? fallback;
          const instantEmail =
            effective === undefined || (effective.enabled && effective.frequency === 'instant');
          const email = people.find((person) => person.id === userId)?.email;
          if (instantEmail && email !== undefined) {
            emailJobs.push({
              to: email,
              template: 'mention',
              locale: 'pt-BR',
              data: {
                actor: actorName,
                item: item?.name ?? '',
                excerpt: bodyText.slice(0, 200),
                link: `${deps.appUrl}/items/${itemId}?update=${updateId}`,
              },
            });
          }
        }
        return recipientList.length;
      },
    );
    for (const email of emailJobs)
      await deps.emails.add('mention', email, { jobId: `mention.${updateId}.${email.to}` });
    return { notified };
  };
}
