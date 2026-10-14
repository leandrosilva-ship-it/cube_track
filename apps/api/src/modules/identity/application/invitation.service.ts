import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, QUEUES } from '@cube-track/shared';
import { and, eq, isNull } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { currentContext, type AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../../core/queues/queues.module.js';
import { AccessService } from '../../access/application/access.service.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../domain/password.js';
import { randomToken, sha256Hex } from '../domain/secrets.js';
import { IdentityRepository } from '../infrastructure/identity.repository.js';
import { SessionService, type IssuedSession } from './session.service.js';

const INVITATION_TTL_MS = 7 * 86_400_000;

export interface InvitationInput {
  email: string;
  roleId: string;
  kind: 'member' | 'guest';
  resource?: { type: 'workspace' | 'board' | 'item'; id: string; roleId: string } | undefined;
  message?: string | undefined;
}

/** Convites por e-mail para membros e convidados externos (com acesso opcional a um recurso). */
@Injectable()
export class InvitationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    private readonly runner: TransactionRunner,
    private readonly events: DomainEvents,
    private readonly access: AccessService,
    private readonly repository: IdentityRepository,
    private readonly sessions: SessionService,
  ) {}

  /** Executa dentro da unidade de trabalho da requisição (rota @Audited transacional). */
  async create(
    user: AuthPrincipal,
    input: InvitationInput,
  ): Promise<{ id: string; email: string; expiresAt: Date }> {
    await this.access.assert(user, 'members.invite', { type: 'tenant' });
    const tx = this.runner.tx;
    const [role] = await tx
      .select()
      .from(schema.roles)
      .where(and(eq(schema.roles.id, input.roleId), isNull(schema.roles.deletedAt)));
    if (role?.scope !== 'tenant')
      throw new ValidationError([
        { path: 'body.roleId', message: 'Use um papel de escopo "tenant".' },
      ]);
    if (input.kind === 'guest' && role.key !== 'guest') {
      throw new ValidationError([
        { path: 'body.roleId', message: 'Convidados externos usam o papel "guest".' },
      ]);
    }
    if (input.kind === 'guest' && input.resource === undefined) {
      throw new ValidationError([
        { path: 'body.resource', message: 'Convidados precisam de acesso a um board ou item.' },
      ]);
    }
    if (input.resource !== undefined) {
      const action = input.resource.type === 'workspace' ? 'workspace.manage' : 'board.share';
      const boardId =
        input.resource.type === 'item'
          ? await this.itemBoard(input.resource.id)
          : input.resource.id;
      await this.access.assert(
        user,
        action,
        input.resource.type === 'workspace'
          ? { type: 'workspace', id: input.resource.id }
          : { type: 'board', id: boardId },
        'Recurso',
      );
    }
    const existing = await this.repository.findUserByEmail(input.email);
    if (existing !== null) {
      const [member] = await tx
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, existing.id));
      if (member?.deletedAt === null)
        throw new ConflictError('Esta pessoa já participa da organização.', 'already_member');
    }
    const token = randomToken();
    const id = newId();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await tx.insert(schema.invitations).values({
      id,
      tenantId: user.tenantId,
      email: input.email.toLowerCase(),
      roleId: input.roleId,
      kind: input.kind,
      resourceType: input.resource?.type ?? null,
      resourceId: input.resource?.id ?? null,
      resourceRoleId: input.resource?.roleId ?? null,
      tokenHash: sha256Hex(token),
      message: input.message ?? null,
      expiresAt,
      createdBy: user.userId,
    });
    this.events.recordChange({
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: id,
      after: { email: input.email, kind: input.kind, resource: input.resource },
    });
    const [tenant] = await tx.select({ name: schema.tenants.name }).from(schema.tenants);
    const [inviter] = await tx
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, user.userId));
    const store = currentContext();
    store?.afterCommit.push(async () => {
      await this.queues[QUEUES.emails].add('invitation', {
        to: input.email,
        template: 'invitation',
        locale: 'pt-BR',
        data: {
          organization: tenant?.name ?? '',
          inviter: inviter?.name ?? '',
          message: input.message ?? '',
          link: `${this.config.APP_URL}/invite?token=${token}`,
        },
      });
    });
    return { id, email: input.email.toLowerCase(), expiresAt };
  }

  async preview(token: string) {
    const found = await this.repository.findInvitationByTokenHash(sha256Hex(token));
    if (found === null || !this.isPending(found.invitation))
      throw new NotFoundError('Convite', 'invitation_invalid');
    const existing = await this.repository.findUserByEmail(found.invitation.email);
    return {
      organization: { name: found.tenantName, slug: found.tenantSlug },
      email: found.invitation.email,
      kind: found.invitation.kind,
      expiresAt: found.invitation.expiresAt,
      accountExists: existing !== null,
    };
  }

  /**
   * Aceite: conta nova (nome + senha) ou existente (senha, ou já autenticado como o mesmo usuário).
   * Cria o membership e a concessão do recurso no tenant do convite e abre a sessão nele.
   */
  async accept(
    input: { token: string; name?: string | undefined; password?: string | undefined },
    authenticated: AuthPrincipal | null,
  ): Promise<IssuedSession> {
    const found = await this.repository.findInvitationByTokenHash(sha256Hex(input.token));
    if (found === null || !this.isPending(found.invitation))
      throw new NotFoundError('Convite', 'invitation_invalid');
    const invitation = found.invitation;
    let user = await this.repository.findUserByEmail(invitation.email);
    if (user === null) {
      if (input.name === undefined || input.password === undefined) {
        throw new ValidationError([
          { path: 'body', message: 'Informe nome e senha para criar a conta.' },
        ]);
      }
      const policy = checkPasswordPolicy(input.password, invitation.email);
      if (!policy.ok)
        throw new ValidationError(
          policy.reasons.map((message) => ({ path: 'body.password', message })),
        );
      user = await this.repository.createUser({
        email: invitation.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        emailVerified: true,
      });
    } else if (authenticated?.userId !== user.id) {
      if (
        input.password === undefined ||
        !(await verifyPassword(user.passwordHash, input.password))
      ) {
        throw new UnauthorizedError(
          'invalid_credentials',
          'Entre com sua conta para aceitar o convite.',
        );
      }
    }
    if (user.status !== 'active') throw new ForbiddenError('Usuário inativo.', 'user_inactive');
    if (!(await this.repository.markInvitationAccepted(invitation.id, user.id)))
      throw new ConflictError('Convite já utilizado.', 'invitation_used');

    const acceptedUser = user;
    await this.runner.run({ tenantId: invitation.tenantId, userId: acceptedUser.id }, async () => {
      const tx = this.runner.tx;
      await tx
        .insert(schema.memberships)
        .values({
          tenantId: invitation.tenantId,
          userId: acceptedUser.id,
          roleId: invitation.roleId,
          kind: invitation.kind,
          status: 'active',
          joinedAt: new Date(),
          createdBy: invitation.createdBy,
        })
        .onConflictDoUpdate({
          target: [schema.memberships.tenantId, schema.memberships.userId],
          set: {
            roleId: invitation.roleId,
            kind: invitation.kind,
            status: 'active',
            deletedAt: null,
          },
        });
      if (
        invitation.resourceType !== null &&
        invitation.resourceId !== null &&
        invitation.resourceRoleId !== null
      ) {
        await tx
          .insert(schema.accessGrants)
          .values({
            tenantId: invitation.tenantId,
            resourceType: invitation.resourceType,
            resourceId: invitation.resourceId,
            principalType: 'user',
            principalId: acceptedUser.id,
            roleId: invitation.resourceRoleId,
            createdBy: invitation.createdBy,
          })
          .onConflictDoNothing();
      }
      this.events.recordChange({
        action: 'invitation.accepted',
        entityType: 'invitation',
        entityId: invitation.id,
        after: { userId: acceptedUser.id },
      });
      await this.access.invalidate(invitation.tenantId);
    });
    const membership = await this.repository.findMembership(acceptedUser.id, invitation.tenantId);
    if (membership === null)
      throw new ForbiddenError('Falha ao vincular à organização.', 'membership_failed');
    return this.sessions.issue({
      user: acceptedUser,
      membership,
      method: 'invitation',
      amr: ['pwd'],
    });
  }

  async revoke(user: AuthPrincipal, invitationId: string): Promise<void> {
    await this.access.assert(user, 'members.invite', { type: 'tenant' });
    const rows = await this.runner.tx
      .update(schema.invitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.invitations.id, invitationId), isNull(schema.invitations.acceptedAt)))
      .returning({ id: schema.invitations.id });
    if (rows.length === 0) throw new NotFoundError('Convite');
    this.events.recordChange({
      action: 'invitation.revoked',
      entityType: 'invitation',
      entityId: invitationId,
    });
  }

  private isPending(invitation: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }): boolean {
    return (
      invitation.acceptedAt === null &&
      invitation.revokedAt === null &&
      invitation.expiresAt.getTime() > Date.now()
    );
  }

  private async itemBoard(itemId: string): Promise<string> {
    const [item] = await this.runner.tx
      .select({ boardId: schema.items.boardId })
      .from(schema.items)
      .where(eq(schema.items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    return item.boardId;
  }
}
