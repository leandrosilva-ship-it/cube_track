import { schema, type DatabaseHandle } from '@cube-track/db';
import { DomainEventJobSchema, type EmailJob } from '@cube-track/shared';
import type { Job, Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { buildReplyAddress } from '../reply-address.js';
import { runAsSystem } from '../system-tx.js';

const {
  mentions,
  notifications,
  notificationPreferences,
  teamMembers,
  items,
  users,
  follows,
  approvalRequests,
  approvalApprovers,
} = schema;

export interface NotificationsDeps {
  database: DatabaseHandle;
  redis: Redis;
  emails: Queue;
  appUrl: string;
  jwtSecret: string;
  mailReplyDomain: string;
}

/**
 * Notificações de domínio acionadas por eventos do outbox (ADR 0048):
 * - `update.created`/`reply.created`: resolve @menções (usuário, time, "todos" = seguidores do
 *   board), cria a notificação in-app, emite `notification.created` e envia e-mail imediato com
 *   endereço de resposta próprio (responder ao e-mail vira uma atualização/resposta no item).
 * - `approval.changed`: pedido novo notifica os aprovadores; resolvido (aprovado/rejeitado/
 *   cancelado) notifica quem pediu.
 */
export function notificationsProcessor(deps: NotificationsDeps) {
  return async (job: Job) => {
    const event = DomainEventJobSchema.parse(job.data);
    if (event.type === 'update.created' || event.type === 'reply.created') {
      return notifyMentions(deps, event);
    }
    if (event.type === 'approval.changed') {
      return notifyApproval(deps, event);
    }
    return { notified: 0 };
  };
}

async function notifyMentions(
  deps: NotificationsDeps,
  event: ReturnType<typeof DomainEventJobSchema.parse>,
) {
  if (event.itemId === null || event.boardId === null) return { notified: 0 };
  const sourceType = event.type === 'update.created' ? ('update' as const) : ('reply' as const);
  const sourceId =
    typeof event.payload[sourceType === 'update' ? 'updateId' : 'replyId'] === 'string'
      ? (event.payload[sourceType === 'update' ? 'updateId' : 'replyId'] as string)
      : '';
  const updateId =
    sourceType === 'update'
      ? sourceId
      : typeof event.payload.updateId === 'string'
        ? event.payload.updateId
        : sourceId;
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
        .where(and(eq(mentions.sourceType, sourceType), eq(mentions.sourceId, sourceId)));
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
        const userPreferences = preferences.filter((preference) => preference.userId === userId);
        const specific = userPreferences.find((preference) => preference.eventType === 'mention');
        const fallback = userPreferences.find((preference) => preference.eventType === '*');
        const effective = specific ?? fallback;
        const instantEmail =
          effective === undefined || (effective.enabled && effective.frequency === 'instant');
        const email = people.find((person) => person.id === userId)?.email;
        const willSendInstant = instantEmail && email !== undefined;

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
            entityType: sourceType,
            entityId: sourceId,
            emailSentAt: willSendInstant ? new Date() : null,
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
        if (willSendInstant) {
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
            replyTo: buildReplyAddress(deps.jwtSecret, deps.mailReplyDomain, {
              itemId,
              userId,
              updateId,
            }),
          });
        }
      }
      return recipientList.length;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add('mention', email, {
      jobId: `mention.${sourceType}.${sourceId}.${email.to}`,
    });
  return { notified };
}

async function notifyApproval(
  deps: NotificationsDeps,
  event: ReturnType<typeof DomainEventJobSchema.parse>,
) {
  if (event.itemId === null || event.boardId === null) return { notified: 0 };
  const requestId = typeof event.payload.requestId === 'string' ? event.payload.requestId : '';
  const status = typeof event.payload.status === 'string' ? event.payload.status : 'pending';
  const requestedBy =
    typeof event.payload.requestedBy === 'string' ? event.payload.requestedBy : null;
  const itemId = event.itemId;
  const boardId = event.boardId;
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
      const [item] = await unit.tx
        .select({ name: items.name })
        .from(items)
        .where(eq(items.id, itemId));
      const itemName = item?.name ?? 'um item';
      const recipients: string[] =
        status === 'pending'
          ? (
              await unit.tx
                .select({ userId: approvalApprovers.userId })
                .from(approvalApprovers)
                .where(eq(approvalApprovers.requestId, requestId))
            ).map((row) => row.userId)
          : requestedBy === null
            ? []
            : [requestedBy];
      if (recipients.length === 0) return 0;
      const [requester] =
        requestedBy === null
          ? [undefined]
          : await unit.tx.select({ name: users.name }).from(users).where(eq(users.id, requestedBy));
      const [request] = await unit.tx
        .select({ note: approvalRequests.note })
        .from(approvalRequests)
        .where(eq(approvalRequests.id, requestId));
      const people = await unit.tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.id, recipients));
      const preferences = await unit.tx
        .select()
        .from(notificationPreferences)
        .where(
          and(
            inArray(notificationPreferences.userId, recipients),
            eq(notificationPreferences.channel, 'email'),
          ),
        );
      const title =
        status === 'pending'
          ? `${requester?.name ?? 'Alguém'} pediu sua aprovação em "${itemName}"`
          : `Seu pedido de aprovação em "${itemName}" foi ${status === 'approved' ? 'aprovado' : status === 'rejected' ? 'rejeitado' : 'cancelado'}`;
      for (const userId of recipients) {
        const userPreferences = preferences.filter((preference) => preference.userId === userId);
        const specific = userPreferences.find((preference) => preference.eventType === 'approval');
        const fallback = userPreferences.find((preference) => preference.eventType === '*');
        const effective = specific ?? fallback;
        const instantEmail =
          effective === undefined || (effective.enabled && effective.frequency === 'instant');
        const email = people.find((person) => person.id === userId)?.email;
        const willSendInstant = status === 'pending' && instantEmail && email !== undefined;

        const [created] = await unit.tx
          .insert(notifications)
          .values({
            tenantId: event.tenantId,
            userId,
            type: 'approval',
            title,
            actorId: event.actorId,
            boardId,
            itemId,
            entityType: 'approval_request',
            entityId: requestId,
            emailSentAt: willSendInstant ? new Date() : null,
          })
          .returning({ id: notifications.id });
        if (created === undefined) continue;
        await unit.emit({
          type: 'notification.created',
          aggregateType: 'notification',
          aggregateId: created.id,
          userId,
          payload: { notificationId: created.id, type: 'approval', title, itemId, boardId },
        });
        if (willSendInstant) {
          emailJobs.push({
            to: email,
            template: 'approval_requested',
            locale: 'pt-BR',
            data: {
              requester: requester?.name ?? 'Alguém',
              item: itemName,
              note: request?.note ?? '',
              link: `${deps.appUrl}/items/${itemId}?tab=approvals`,
            },
          });
        }
      }
      return recipients.length;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add('approval_requested', email, {
      jobId: `approval.${requestId}.${email.to}`,
    });
  return { notified };
}
