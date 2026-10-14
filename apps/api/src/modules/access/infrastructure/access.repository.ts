import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import { ColumnPermissionsSchema, type ColumnPermissions } from '@cube-track/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type {
  BoardInput,
  GrantRow,
  RoleDefinition,
  WorkspaceInput,
} from '../domain/effective-access.js';

export interface PrincipalRow {
  roleId: string;
  roleKey: string;
  kind: 'member' | 'guest';
  permissions: string[];
  teamIds: string[];
}

export interface BoardColumn {
  id: string;
  key: string;
  type: string;
  title: string;
  binding: string | null;
  permissions: ColumnPermissions;
}

const {
  memberships,
  roles,
  rolePermissions,
  teamMembers,
  workspaces,
  boards,
  accessGrants,
  columnDefinitions,
  views,
  dashboards,
} = schema;

/** Consultas do RBAC (executadas na transação corrente, sob RLS do tenant). */
@Injectable()
export class AccessRepository {
  async loadPrincipal(tx: Transaction, userId: string): Promise<PrincipalRow | null> {
    const [membership] = await tx
      .select({ roleId: memberships.roleId, roleKey: roles.key, kind: memberships.kind })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          isNull(memberships.deletedAt),
        ),
      );
    if (membership === undefined) return null;
    const permissions = await tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, membership.roleId));
    const teams = await tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));
    return {
      roleId: membership.roleId,
      roleKey: membership.roleKey,
      kind: membership.kind,
      permissions: permissions.map((row) => row.key),
      teamIds: teams.map((row) => row.teamId),
    };
  }

  async loadRoles(tx: Transaction): Promise<RoleDefinition[]> {
    const rows = await tx
      .select({
        id: roles.id,
        key: roles.key,
        scope: roles.scope,
        permissions: sql<
          string[]
        >`coalesce(array_agg(${rolePermissions.permissionKey}) filter (where ${rolePermissions.permissionKey} is not null), '{}')`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(isNull(roles.deletedAt))
      .groupBy(roles.id, roles.key, roles.scope);
    return rows;
  }

  async loadGrants(
    tx: Transaction,
    resourceType: 'workspace' | 'board' | 'item' | 'view' | 'dashboard',
    resourceId: string,
  ): Promise<GrantRow[]> {
    return tx
      .select({
        roleId: accessGrants.roleId,
        principalType: accessGrants.principalType,
        principalId: accessGrants.principalId,
      })
      .from(accessGrants)
      .where(
        and(
          eq(accessGrants.resourceType, resourceType),
          eq(accessGrants.resourceId, resourceId),
          or(isNull(accessGrants.expiresAt), sql`${accessGrants.expiresAt} > now()`),
        ),
      );
  }

  async loadWorkspace(tx: Transaction, workspaceId: string): Promise<WorkspaceInput | null> {
    const [row] = await tx
      .select({ id: workspaces.id, visibility: workspaces.visibility })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
    return row ?? null;
  }

  async loadBoard(tx: Transaction, boardId: string): Promise<BoardInput | null> {
    const [row] = await tx
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        visibility: boards.visibility,
        ownerId: boards.ownerId,
        settings: boards.settings,
      })
      .from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)));
    if (row === undefined) return null;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      visibility: row.visibility,
      ownerId: row.ownerId,
      guestItemVisibility: row.settings.guestItemVisibility === 'all' ? 'all' : 'assigned',
    };
  }

  async listBoardIds(tx: Transaction): Promise<string[]> {
    const rows = await tx.select({ id: boards.id }).from(boards).where(isNull(boards.deletedAt));
    return rows.map((row) => row.id);
  }

  async loadColumns(tx: Transaction, boardId: string): Promise<BoardColumn[]> {
    const rows = await tx
      .select({
        id: columnDefinitions.id,
        key: columnDefinitions.key,
        type: columnDefinitions.type,
        title: columnDefinitions.title,
        binding: columnDefinitions.binding,
        permissions: columnDefinitions.permissions,
      })
      .from(columnDefinitions)
      .where(and(eq(columnDefinitions.boardId, boardId), isNull(columnDefinitions.deletedAt)))
      .orderBy(columnDefinitions.position);
    return rows.map((row) => ({
      ...row,
      permissions: ColumnPermissionsSchema.catch({}).parse(row.permissions),
    }));
  }

  async loadView(tx: Transaction, viewId: string) {
    const [row] = await tx
      .select({
        id: views.id,
        boardId: views.boardId,
        ownerId: views.ownerId,
        isRestricted: views.isRestricted,
        isLocked: views.isLocked,
      })
      .from(views)
      .where(and(eq(views.id, viewId), isNull(views.deletedAt)));
    return row ?? null;
  }

  async loadDashboard(tx: Transaction, dashboardId: string) {
    const [row] = await tx
      .select({
        id: dashboards.id,
        workspaceId: dashboards.workspaceId,
        ownerId: dashboards.ownerId,
        visibility: dashboards.visibility,
      })
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), isNull(dashboards.deletedAt)));
    return row ?? null;
  }

  async loadItemsBoard(tx: Transaction, itemIds: string[]) {
    if (itemIds.length === 0) return [];
    return tx
      .select({ id: schema.items.id, boardId: schema.items.boardId, values: schema.items.values })
      .from(schema.items)
      .where(and(inArray(schema.items.id, itemIds), isNull(schema.items.deletedAt)));
  }
}
