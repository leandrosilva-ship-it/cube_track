import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { isPermissionOfScope, newId, type PermissionScope } from '@cube-track/shared';
import { and, count, eq, isNull, sql } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from './access.service.js';

const { roles, rolePermissions, accessGrants, memberships, users, items, views } = schema;

export interface RoleInput {
  key: string;
  name: string;
  description?: string | undefined;
  scope: PermissionScope;
  permissions: string[];
}

export interface GrantInput {
  resourceType: 'workspace' | 'board' | 'view' | 'item';
  resourceId: string;
  principalType: 'user' | 'team';
  principalId: string;
  roleId: string;
  expiresAt?: string | undefined;
}

/** Papéis customizados, concessões de acesso e papéis de membros (todas as mudanças invalidam o cache). */
@Injectable()
export class AccessAdminService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async listRoles() {
    const rows = await this.runner.tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        description: roles.description,
        scope: roles.scope,
        isSystem: roles.isSystem,
        permissions: sql<
          string[]
        >`coalesce(array_agg(${rolePermissions.permissionKey} order by ${rolePermissions.permissionKey}) filter (where ${rolePermissions.permissionKey} is not null), '{}')`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(isNull(roles.deletedAt))
      .groupBy(roles.id)
      .orderBy(roles.scope, roles.name);
    return rows;
  }

  async createRole(user: AuthPrincipal, input: RoleInput) {
    await this.access.assert(user, 'roles.manage', { type: 'tenant' });
    this.validatePermissions(input.scope, input.permissions);
    const id = newId();
    await this.runner.tx.insert(roles).values({
      id,
      tenantId: user.tenantId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      scope: input.scope,
      isSystem: false,
      createdBy: user.userId,
    });
    await this.replacePermissions(user, id, input.permissions);
    this.events.recordChange({
      action: 'role.created',
      entityType: 'role',
      entityId: id,
      after: input,
    });
    await this.changed(user, 'tenant', null);
    return { id, ...input, description: input.description ?? null, isSystem: false };
  }

  async updateRole(
    user: AuthPrincipal,
    roleId: string,
    input: {
      name?: string | undefined;
      description?: string | undefined;
      permissions?: string[] | undefined;
    },
  ) {
    await this.access.assert(user, 'roles.manage', { type: 'tenant' });
    const role = await this.findRole(roleId);
    if (role.isSystem)
      throw new UnprocessableError('Papéis de sistema não podem ser alterados.', 'system_role');
    if (input.permissions !== undefined) this.validatePermissions(role.scope, input.permissions);
    await this.runner.tx
      .update(roles)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      })
      .where(eq(roles.id, roleId));
    if (input.permissions !== undefined)
      await this.replacePermissions(user, roleId, input.permissions);
    this.events.recordChange({
      action: 'role.updated',
      entityType: 'role',
      entityId: roleId,
      before: role,
      after: input,
    });
    await this.changed(user, 'tenant', null);
    return { ...role, ...input };
  }

  async deleteRole(user: AuthPrincipal, roleId: string): Promise<void> {
    await this.access.assert(user, 'roles.manage', { type: 'tenant' });
    const role = await this.findRole(roleId);
    if (role.isSystem)
      throw new UnprocessableError('Papéis de sistema não podem ser excluídos.', 'system_role');
    const [inUse] = await this.runner.tx
      .select({ total: count() })
      .from(accessGrants)
      .where(eq(accessGrants.roleId, roleId));
    const [members] = await this.runner.tx
      .select({ total: count() })
      .from(memberships)
      .where(eq(memberships.roleId, roleId));
    if ((inUse?.total ?? 0) + (members?.total ?? 0) > 0)
      throw new ConflictError('O papel está em uso.', 'role_in_use');
    await this.runner.tx.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, roleId));
    this.events.recordChange({
      action: 'role.deleted',
      entityType: 'role',
      entityId: roleId,
      before: role,
    });
    await this.changed(user, 'tenant', null);
  }

  async listGrants(
    user: AuthPrincipal,
    resourceType: GrantInput['resourceType'],
    resourceId: string,
  ) {
    await this.assertCanShare(user, resourceType, resourceId);
    return this.runner.tx
      .select({
        id: accessGrants.id,
        resourceType: accessGrants.resourceType,
        resourceId: accessGrants.resourceId,
        principalType: accessGrants.principalType,
        principalId: accessGrants.principalId,
        roleId: accessGrants.roleId,
        expiresAt: accessGrants.expiresAt,
      })
      .from(accessGrants)
      .where(
        and(eq(accessGrants.resourceType, resourceType), eq(accessGrants.resourceId, resourceId)),
      );
  }

  async createGrant(user: AuthPrincipal, input: GrantInput) {
    await this.assertCanShare(user, input.resourceType, input.resourceId);
    const role = await this.findRole(input.roleId);
    const expectedScope = input.resourceType === 'workspace' ? 'workspace' : 'board';
    if (role.scope !== expectedScope) {
      throw new ValidationError([
        { path: 'roleId', message: `Use um papel de escopo "${expectedScope}".` },
      ]);
    }
    const id = newId();
    await this.runner.tx
      .insert(accessGrants)
      .values({
        id,
        tenantId: user.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        principalType: input.principalType,
        principalId: input.principalId,
        roleId: input.roleId,
        expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt),
        createdBy: user.userId,
      })
      .onConflictDoUpdate({
        target: [
          accessGrants.tenantId,
          accessGrants.resourceType,
          accessGrants.resourceId,
          accessGrants.principalType,
          accessGrants.principalId,
        ],
        set: {
          roleId: input.roleId,
          expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt),
        },
      });
    this.events.recordChange({
      action: 'access_grant.upserted',
      entityType: input.resourceType,
      entityId: input.resourceId,
      after: input,
    });
    await this.changed(
      user,
      input.resourceType === 'workspace' ? 'workspace' : 'board',
      input.resourceId,
    );
    return { id, ...input, expiresAt: input.expiresAt ?? null };
  }

  async deleteGrant(user: AuthPrincipal, grantId: string): Promise<void> {
    const [grant] = await this.runner.tx
      .select()
      .from(accessGrants)
      .where(eq(accessGrants.id, grantId));
    if (grant === undefined) throw new NotFoundError('Concessão');
    if (
      grant.resourceType !== 'workspace' &&
      grant.resourceType !== 'board' &&
      grant.resourceType !== 'view' &&
      grant.resourceType !== 'item'
    ) {
      throw new UnprocessableError('Tipo de recurso não suportado.');
    }
    await this.assertCanShare(user, grant.resourceType, grant.resourceId);
    await this.runner.tx.delete(accessGrants).where(eq(accessGrants.id, grantId));
    this.events.recordChange({
      action: 'access_grant.deleted',
      entityType: grant.resourceType,
      entityId: grant.resourceId,
      before: grant,
    });
    await this.changed(
      user,
      grant.resourceType === 'workspace' ? 'workspace' : 'board',
      grant.resourceId,
    );
  }

  async listMembers() {
    return this.runner.tx
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        kind: memberships.kind,
        status: memberships.status,
        roleId: memberships.roleId,
        jobTitle: memberships.jobTitle,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(isNull(memberships.deletedAt))
      .orderBy(users.name);
  }

  async updateMember(
    user: AuthPrincipal,
    userId: string,
    input: { roleId?: string | undefined; status?: 'active' | 'suspended' | undefined },
  ) {
    await this.access.assert(user, 'members.manage', { type: 'tenant' });
    const [member] = await this.runner.tx
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    if (member === undefined) throw new NotFoundError('Membro');
    if (input.roleId !== undefined) {
      const role = await this.findRole(input.roleId);
      if (role.scope !== 'tenant')
        throw new ValidationError([
          { path: 'roleId', message: 'Use um papel de escopo "tenant".' },
        ]);
      if (role.key === 'owner' && !(await this.isOwner(user))) {
        throw new UnprocessableError(
          'Somente proprietários podem promover outro proprietário.',
          'owner_required',
        );
      }
    }
    if (userId === user.userId && input.status === 'suspended') {
      throw new UnprocessableError('Você não pode suspender a própria conta.', 'self_suspend');
    }
    await this.runner.tx
      .update(memberships)
      .set({
        ...(input.roleId === undefined ? {} : { roleId: input.roleId }),
        ...(input.status === undefined ? {} : { status: input.status }),
      })
      .where(eq(memberships.userId, userId));
    this.events.recordChange({
      action: 'membership.updated',
      entityType: 'membership',
      entityId: member.id,
      before: member,
      after: input,
    });
    await this.changed(user, 'tenant', null);
    return { userId, ...input };
  }

  // ------------------------------------------------------------------------------ internos ---

  private async isOwner(user: AuthPrincipal): Promise<boolean> {
    return (await this.access.principal(user)).tenantRoleKey === 'owner';
  }

  private async assertCanShare(
    user: AuthPrincipal,
    resourceType: GrantInput['resourceType'],
    resourceId: string,
  ): Promise<void> {
    if (resourceType === 'workspace') {
      await this.access.assert(
        user,
        'workspace.manage',
        { type: 'workspace', id: resourceId },
        'Workspace',
      );
      return;
    }
    let boardId = resourceId;
    if (resourceType === 'item') {
      const [item] = await this.runner.tx
        .select({ boardId: items.boardId })
        .from(items)
        .where(eq(items.id, resourceId));
      if (item === undefined) throw new NotFoundError('Item');
      boardId = item.boardId;
    } else if (resourceType === 'view') {
      const [view] = await this.runner.tx
        .select({ boardId: views.boardId })
        .from(views)
        .where(eq(views.id, resourceId));
      if (view === undefined) throw new NotFoundError('View');
      boardId = view.boardId;
    }
    await this.access.assert(user, 'board.share', { type: 'board', id: boardId }, 'Board');
  }

  private validatePermissions(scope: PermissionScope, permissions: readonly string[]): void {
    const invalid = permissions.filter((permission) => !isPermissionOfScope(permission, scope));
    if (invalid.length > 0) {
      throw new ValidationError(
        invalid.map((permission) => ({
          path: 'permissions',
          message: `Permissão inválida para o escopo ${scope}: ${permission}`,
        })),
      );
    }
  }

  private async replacePermissions(
    user: AuthPrincipal,
    roleId: string,
    permissions: readonly string[],
  ): Promise<void> {
    await this.runner.tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissions.length > 0) {
      await this.runner.tx.insert(rolePermissions).values(
        [...new Set(permissions)].map((permissionKey) => ({
          tenantId: user.tenantId,
          roleId,
          permissionKey,
          createdBy: user.userId,
        })),
      );
    }
  }

  private async findRole(roleId: string) {
    const [role] = await this.runner.tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        scope: roles.scope,
        isSystem: roles.isSystem,
        description: roles.description,
      })
      .from(roles)
      .where(and(eq(roles.id, roleId), isNull(roles.deletedAt)));
    if (role === undefined) throw new NotFoundError('Papel');
    return role;
  }

  private async changed(
    user: AuthPrincipal,
    scope: 'tenant' | 'workspace' | 'board',
    resourceId: string | null,
  ): Promise<void> {
    await this.access.invalidate(user.tenantId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'permission.changed',
      aggregateType: scope,
      aggregateId: resourceId ?? user.tenantId,
      payload: { scope, resourceId },
      actorId: user.userId,
    });
  }
}
