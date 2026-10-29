import { schema, type DatabaseHandle, type Transaction } from '@cube-track/db';
import { DomainEventJobSchema, type EmailJob } from '@cube-track/shared';
import type { Job, Queue } from 'bullmq';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
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
  absences,
  resourceRequests,
  resourceProfiles,
  boards,
  accessGrants,
  rolePermissions,
  workspaces,
  risks,
  issues,
  projectHealth,
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
 * - `absence.changed`/`resource_request.changed`/`timesheet_approval.changed` (ADR 0052): pedido/
 *   envio novo notifica quem tem `resources.manage`/`timesheet.approve` no workspace principal do
 *   tenant; decisão (aprovado/rejeitado/atendido) notifica quem pediu/enviou.
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
    if (event.type === 'absence.changed') {
      return notifyAbsence(deps, event);
    }
    if (event.type === 'resource_request.changed') {
      return notifyResourceRequest(deps, event);
    }
    if (event.type === 'timesheet_approval.changed') {
      return notifyTimesheetApproval(deps, event);
    }
    if (event.type === 'risk.changed') {
      return notifyRisk(deps, event);
    }
    if (event.type === 'issue.changed') {
      return notifyIssue(deps, event);
    }
    if (event.type === 'project_health.changed') {
      return notifyProjectHealthAlert(deps, event);
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

/** Usuários (diretos ou via time) com `permissionKey` no workspace principal do tenant (ADR 0052). */
async function resourcePermissionHolders(
  tx: Transaction,
  tenantId: string,
  permissionKey: string,
): Promise<string[]> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(eq(workspaces.tenantId, tenantId), isNull(workspaces.deletedAt), isNull(workspaces.archivedAt)),
    )
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  if (workspace === undefined) return [];
  const roleRows = await tx
    .select({ roleId: rolePermissions.roleId })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.permissionKey, permissionKey)));
  const roleIds = roleRows.map((row) => row.roleId);
  if (roleIds.length === 0) return [];
  const grants = await tx
    .select({ principalType: accessGrants.principalType, principalId: accessGrants.principalId })
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.tenantId, tenantId),
        eq(accessGrants.resourceType, 'workspace'),
        eq(accessGrants.resourceId, workspace.id),
        inArray(accessGrants.roleId, roleIds),
      ),
    );
  const recipients = new Set<string>();
  for (const grant of grants) {
    if (grant.principalType === 'user') {
      recipients.add(grant.principalId);
      continue;
    }
    const members = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, grant.principalId));
    members.forEach((member) => recipients.add(member.userId));
  }
  return [...recipients];
}

/** Gestor direto de `userId` (`resource_profiles.managerId`), se existir. */
async function managerOf(tx: Transaction, tenantId: string, userId: string): Promise<string | null> {
  const [profile] = await tx
    .select({ managerId: resourceProfiles.managerId })
    .from(resourceProfiles)
    .where(and(eq(resourceProfiles.tenantId, tenantId), eq(resourceProfiles.userId, userId)));
  return profile?.managerId ?? null;
}

interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  boardId?: string | null;
  itemId?: string | null;
  entityType?: string;
  entityId?: string;
}

/**
 * Grava a notificação in-app, emite `notification.created` e resolve se envia e-mail instantâneo
 * (preferência específica de `type` → curinga `'*'` → padrão instantâneo, mesma regra de sempre).
 * Devolve o e-mail da pessoa quando um envio instantâneo deve acontecer (o chamador monta o
 * `EmailJob` com o template certo), ou `null` quando não deve enviar.
 */
async function notifyUser(
  tx: Transaction,
  tenantId: string,
  actorId: string | null,
  input: NotifyInput,
): Promise<string | null> {
  const [person] = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, input.userId));
  const preferences = await tx
    .select()
    .from(notificationPreferences)
    .where(
      and(eq(notificationPreferences.userId, input.userId), eq(notificationPreferences.channel, 'email')),
    );
  const specific = preferences.find((entry) => entry.eventType === input.type);
  const fallback = preferences.find((entry) => entry.eventType === '*');
  const effective = specific ?? fallback;
  const instantEmail = effective === undefined || (effective.enabled && effective.frequency === 'instant');
  const email = person?.email;
  const willSendInstant = instantEmail && email !== undefined;

  const [created] = await tx
    .insert(notifications)
    .values({
      tenantId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      actorId,
      boardId: input.boardId ?? null,
      itemId: input.itemId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      emailSentAt: willSendInstant ? new Date() : null,
    })
    .returning({ id: notifications.id });
  if (created === undefined) return null;
  return willSendInstant ? email : null;
}

async function notifyAbsence(
  deps: NotificationsDeps,
  event: ReturnType<typeof DomainEventJobSchema.parse>,
) {
  const absenceId = typeof event.payload.absenceId === 'string' ? event.payload.absenceId : '';
  const userId = typeof event.payload.userId === 'string' ? event.payload.userId : '';
  const change = typeof event.payload.change === 'string' ? event.payload.change : '';
  if (absenceId === '' || userId === '') return { notified: 0 };
  const emailJobs: EmailJob[] = [];

  const notified = await runAsSystem(
    deps.database,
    deps.redis,
    event.tenantId,
    { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
    async (unit) => {
      const [absence] = await unit.tx.select().from(absences).where(eq(absences.id, absenceId));
      if (absence === undefined) return 0;
      const [requester] = await unit.tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, absence.userId));
      const requesterName = requester?.name ?? 'Alguém';

      let recipients: string[];
      let title: string;
      if (change === 'created') {
        const manager = await managerOf(unit.tx, event.tenantId, absence.userId);
        recipients =
          manager !== null
            ? [manager]
            : await resourcePermissionHolders(unit.tx, event.tenantId, 'resources.manage');
        title = `${requesterName} solicitou ausência`;
      } else if (change === 'approved' || change === 'rejected') {
        recipients = [absence.userId];
        title = `Sua ausência foi ${change === 'approved' ? 'aprovada' : 'recusada'}`;
      } else {
        return 0;
      }

      for (const recipientId of recipients) {
        const email = await notifyUser(unit.tx, event.tenantId, event.actorId, {
          userId: recipientId,
          type: 'absence',
          title,
          entityType: 'absence',
          entityId: absenceId,
        });
        await unit.emit({
          type: 'notification.created',
          aggregateType: 'notification',
          aggregateId: absenceId,
          userId: recipientId,
          payload: { notificationId: absenceId, type: 'absence', title, itemId: null, boardId: null },
        });
        if (email !== null) {
          emailJobs.push({
            to: email,
            template: change === 'created' ? 'absence_requested' : 'absence_decided',
            locale: 'pt-BR',
            data: {
              requester: requesterName,
              type: absence.type,
              status: change === 'approved' ? 'aprovada' : 'recusada',
              startDate: absence.startDate,
              endDate: absence.endDate,
              link: `${deps.appUrl}/capacity`,
            },
          });
        }
      }
      return recipients.length;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add(email.template, email, { jobId: `absence.${absenceId}.${change}.${email.to}` });
  return { notified };
}

async function notifyResourceRequest(
  deps: NotificationsDeps,
  event: ReturnType<typeof DomainEventJobSchema.parse>,
) {
  const requestId = typeof event.payload.requestId === 'string' ? event.payload.requestId : '';
  const change = typeof event.payload.change === 'string' ? event.payload.change : '';
  const boardId = typeof event.payload.boardId === 'string' ? event.payload.boardId : '';
  if (requestId === '' || boardId === '') return { notified: 0 };
  const emailJobs: EmailJob[] = [];

  const notified = await runAsSystem(
    deps.database,
    deps.redis,
    event.tenantId,
    { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
    async (unit) => {
      const [request] = await unit.tx
        .select()
        .from(resourceRequests)
        .where(eq(resourceRequests.id, requestId));
      if (request === undefined) return 0;
      const [board] = await unit.tx
        .select({ name: boards.name, ownerId: boards.ownerId })
        .from(boards)
        .where(eq(boards.id, boardId));

      let recipients: string[];
      if (change === 'created') {
        recipients = await resourcePermissionHolders(unit.tx, event.tenantId, 'resources.manage');
      } else if (change === 'fulfilled' || change === 'cancelled') {
        recipients = board?.ownerId === undefined || board.ownerId === null ? [] : [board.ownerId];
      } else {
        return 0;
      }
      if (recipients.length === 0) return 0;

      const title =
        change === 'created'
          ? `Nova solicitação de recurso: "${request.roleTitle}"`
          : change === 'fulfilled'
            ? `Solicitação de recurso "${request.roleTitle}" foi atendida`
            : `Solicitação de recurso "${request.roleTitle}" foi cancelada`;

      for (const recipientId of recipients) {
        const email = await notifyUser(unit.tx, event.tenantId, event.actorId, {
          userId: recipientId,
          type: 'resource_request',
          title,
          boardId,
          entityType: 'resource_request',
          entityId: requestId,
        });
        await unit.emit({
          type: 'notification.created',
          aggregateType: 'notification',
          aggregateId: requestId,
          userId: recipientId,
          payload: { notificationId: requestId, type: 'resource_request', title, itemId: null, boardId },
        });
        if (email !== null && change !== 'cancelled') {
          emailJobs.push({
            to: email,
            template: change === 'created' ? 'resource_request_created' : 'resource_request_fulfilled',
            locale: 'pt-BR',
            data: { roleTitle: request.roleTitle, link: `${deps.appUrl}/boards/${boardId}` },
          });
        }
      }
      return recipients.length;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add(email.template, email, {
      jobId: `resource_request.${requestId}.${change}.${email.to}`,
    });
  return { notified };
}

async function notifyTimesheetApproval(
  deps: NotificationsDeps,
  event: ReturnType<typeof DomainEventJobSchema.parse>,
) {
  const approvalId = typeof event.payload.approvalId === 'string' ? event.payload.approvalId : '';
  const userId = typeof event.payload.userId === 'string' ? event.payload.userId : '';
  const status = typeof event.payload.status === 'string' ? event.payload.status : '';
  const periodStart = typeof event.payload.periodStart === 'string' ? event.payload.periodStart : '';
  if (approvalId === '' || userId === '') return { notified: 0 };
  if (status !== 'submitted' && status !== 'approved' && status !== 'rejected') return { notified: 0 };
  const emailJobs: EmailJob[] = [];

  const notified = await runAsSystem(
    deps.database,
    deps.redis,
    event.tenantId,
    { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
    async (unit) => {
      const [person] = await unit.tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
      const personName = person?.name ?? 'Alguém';

      let recipients: string[];
      let template: 'timesheet_submitted' | 'timesheet_decided';
      let title: string;
      if (status === 'submitted') {
        const manager = await managerOf(unit.tx, event.tenantId, userId);
        recipients =
          manager !== null
            ? [manager]
            : await resourcePermissionHolders(unit.tx, event.tenantId, 'timesheet.approve');
        template = 'timesheet_submitted';
        title = `${personName} enviou o timesheet da semana de ${periodStart}`;
      } else {
        recipients = [userId];
        template = 'timesheet_decided';
        title = `Seu timesheet foi ${status === 'approved' ? 'aprovado' : 'recusado'}`;
      }
      if (recipients.length === 0) return 0;

      for (const recipientId of recipients) {
        const email = await notifyUser(unit.tx, event.tenantId, event.actorId, {
          userId: recipientId,
          type: 'timesheet',
          title,
          entityType: 'timesheet_approval',
          entityId: approvalId,
        });
        await unit.emit({
          type: 'notification.created',
          aggregateType: 'notification',
          aggregateId: approvalId,
          userId: recipientId,
          payload: { notificationId: approvalId, type: 'timesheet', title, itemId: null, boardId: null },
        });
        if (email !== null) {
          emailJobs.push({
            to: email,
            template,
            locale: 'pt-BR',
            data: {
              person: personName,
              periodStart,
              status: status === 'approved' ? 'aprovado' : 'recusado',
              link: `${deps.appUrl}/timesheet`,
            },
          });
        }
      }
      return recipients.length;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add(email.template, email, {
      jobId: `timesheet_approval.${approvalId}.${status}.${email.to}`,
    });
  return { notified };
}

/** Notifica o responsável só na criação (ADR 0053) — detectar reatribuição em `updated` exigiria
 * before/after, que este evento não carrega; escopo documentado como limitação conhecida. */
async function notifyRisk(deps: NotificationsDeps, event: ReturnType<typeof DomainEventJobSchema.parse>) {
  const riskId = typeof event.payload.riskId === 'string' ? event.payload.riskId : '';
  const change = typeof event.payload.change === 'string' ? event.payload.change : '';
  const boardId = typeof event.payload.boardId === 'string' ? event.payload.boardId : '';
  if (riskId === '' || boardId === '' || change !== 'created') return { notified: 0 };
  const emailJobs: EmailJob[] = [];

  const notified = await runAsSystem(
    deps.database,
    deps.redis,
    event.tenantId,
    { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
    async (unit) => {
      const [risk] = await unit.tx.select().from(risks).where(eq(risks.id, riskId));
      if (risk === undefined || risk.ownerId === null) return 0;
      const [board] = await unit.tx.select({ name: boards.name }).from(boards).where(eq(boards.id, boardId));
      const title = `Risco atribuído a você: "${risk.title}"`;
      const email = await notifyUser(unit.tx, event.tenantId, event.actorId, {
        userId: risk.ownerId,
        type: 'risk',
        title,
        boardId,
        entityType: 'risk',
        entityId: riskId,
      });
      await unit.emit({
        type: 'notification.created',
        aggregateType: 'notification',
        aggregateId: riskId,
        userId: risk.ownerId,
        payload: { notificationId: riskId, type: 'risk', title, itemId: null, boardId },
      });
      if (email !== null) {
        emailJobs.push({
          to: email,
          template: 'risk_assigned',
          locale: 'pt-BR',
          data: { title: risk.title, boardName: board?.name ?? '', link: `${deps.appUrl}/boards/${boardId}` },
        });
      }
      return 1;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add(email.template, email, { jobId: `risk.${riskId}.assigned.${email.to}` });
  return { notified };
}

/** Mesmo escopo de `notifyRisk`: só notifica na criação do problema (ADR 0053). */
async function notifyIssue(deps: NotificationsDeps, event: ReturnType<typeof DomainEventJobSchema.parse>) {
  const issueId = typeof event.payload.issueId === 'string' ? event.payload.issueId : '';
  const change = typeof event.payload.change === 'string' ? event.payload.change : '';
  const boardId = typeof event.payload.boardId === 'string' ? event.payload.boardId : '';
  if (issueId === '' || boardId === '' || change !== 'created') return { notified: 0 };
  const emailJobs: EmailJob[] = [];

  const notified = await runAsSystem(
    deps.database,
    deps.redis,
    event.tenantId,
    { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
    async (unit) => {
      const [issue] = await unit.tx.select().from(issues).where(eq(issues.id, issueId));
      if (issue === undefined || issue.ownerId === null) return 0;
      const [board] = await unit.tx.select({ name: boards.name }).from(boards).where(eq(boards.id, boardId));
      const title = `Problema atribuído a você: "${issue.title}"`;
      const email = await notifyUser(unit.tx, event.tenantId, event.actorId, {
        userId: issue.ownerId,
        type: 'issue',
        title,
        boardId,
        entityType: 'issue',
        entityId: issueId,
      });
      await unit.emit({
        type: 'notification.created',
        aggregateType: 'notification',
        aggregateId: issueId,
        userId: issue.ownerId,
        payload: { notificationId: issueId, type: 'issue', title, itemId: null, boardId },
      });
      if (email !== null) {
        emailJobs.push({
          to: email,
          template: 'issue_assigned',
          locale: 'pt-BR',
          data: { title: issue.title, boardName: board?.name ?? '', link: `${deps.appUrl}/boards/${boardId}` },
        });
      }
      return 1;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add(email.template, email, { jobId: `issue.${issueId}.assigned.${email.to}` });
  return { notified };
}

const HEALTH_RANK: Record<string, number> = { grey: 0, green: 1, yellow: 2, red: 3 };

/**
 * Alerta o dono do board (ADR 0053) quando o RAG automático piora (vira `yellow`/`red` e é pior que
 * o relato anterior) — overrides manuais (`isAutomatic: false`) não geram alerta: quem sobrepôs já
 * decidiu a cor conscientemente.
 */
async function notifyProjectHealthAlert(
  deps: NotificationsDeps,
  event: ReturnType<typeof DomainEventJobSchema.parse>,
) {
  const healthId = typeof event.payload.healthId === 'string' ? event.payload.healthId : '';
  const boardId = typeof event.payload.boardId === 'string' ? event.payload.boardId : '';
  const overall = typeof event.payload.overall === 'string' ? event.payload.overall : '';
  const isAutomatic = event.payload.isAutomatic === true;
  if (healthId === '' || boardId === '' || !isAutomatic) return { notified: 0 };
  if (overall !== 'yellow' && overall !== 'red') return { notified: 0 };
  const emailJobs: EmailJob[] = [];

  const notified = await runAsSystem(
    deps.database,
    deps.redis,
    event.tenantId,
    { kind: 'system', causationId: event.eventId, depth: event.depth, correlationId: event.eventId },
    async (unit) => {
      const history = await unit.tx
        .select({ id: projectHealth.id, overall: projectHealth.overall })
        .from(projectHealth)
        .where(eq(projectHealth.boardId, boardId))
        .orderBy(desc(projectHealth.reportedAt))
        .limit(2);
      const previous = history.find((row) => row.id !== healthId);
      if (previous !== undefined && (HEALTH_RANK[previous.overall] ?? 0) >= (HEALTH_RANK[overall] ?? 0)) return 0;

      const [board] = await unit.tx.select({ name: boards.name, ownerId: boards.ownerId }).from(boards).where(eq(boards.id, boardId));
      if (board?.ownerId === undefined || board.ownerId === null) return 0;
      const title = `Saúde do projeto ${board.name} mudou para ${overall}`;
      const email = await notifyUser(unit.tx, event.tenantId, event.actorId, {
        userId: board.ownerId,
        type: 'project_health',
        title,
        boardId,
        entityType: 'project_health',
        entityId: healthId,
      });
      await unit.emit({
        type: 'notification.created',
        aggregateType: 'notification',
        aggregateId: healthId,
        userId: board.ownerId,
        payload: { notificationId: healthId, type: 'project_health', title, itemId: null, boardId },
      });
      if (email !== null) {
        emailJobs.push({
          to: email,
          template: 'project_health_alert',
          locale: 'pt-BR',
          data: { boardName: board.name, status: overall, link: `${deps.appUrl}/boards/${boardId}` },
        });
      }
      return 1;
    },
  );
  for (const email of emailJobs)
    await deps.emails.add(email.template, email, { jobId: `project_health.${healthId}.alert.${email.to}` });
  return { notified };
}
