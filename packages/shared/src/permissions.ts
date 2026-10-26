import { z } from 'zod';

/**
 * RBAC em 5 níveis (workspace, board, view, coluna e item) — ver docs/permissions.md.
 *
 * Este módulo contém apenas regras puras: o catálogo de ações e a função `decide`, que recebe um
 * retrato (snapshot) já resolvido das permissões efetivas. Carregar o snapshot (papéis, concessões,
 * times, cache) é responsabilidade do `AccessService` da API.
 */

export const TENANT_PERMISSIONS = [
  'tenant.manage',
  'tenant.billing',
  'members.invite',
  'members.manage',
  'teams.manage',
  'roles.manage',
  'audit.read',
  'api_tokens.manage',
  'templates.manage',
  'workspace.create',
] as const;

export const WORKSPACE_PERMISSIONS = [
  'workspace.read',
  'workspace.manage',
  'folder.manage',
  'board.create',
  'dashboard.create',
  'portfolio.manage',
  'portfolio.read',
  'resources.manage',
  'timesheet.approve',
  'contract.read',
  'contract.manage',
  'contract.measure',
] as const;

export const BOARD_PERMISSIONS = [
  'board.read',
  'board.manage',
  'board.share',
  'board.export',
  'column.manage',
  'group.manage',
  'view.manage',
  'item.create',
  'item.update',
  'item.update_assigned',
  'item.delete',
  'item.comment',
  'file.upload',
  'automation.manage',
  'form.manage',
  'timesheet.log',
  'schedule.manage',
  'process.manage',
  'webhook.manage',
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];
export type BoardPermission = (typeof BOARD_PERMISSIONS)[number];
export type PermissionKey = TenantPermission | WorkspacePermission | BoardPermission;

export const PERMISSION_SCOPES = {
  tenant: TENANT_PERMISSIONS,
  workspace: WORKSPACE_PERMISSIONS,
  board: BOARD_PERMISSIONS,
} as const;
export type PermissionScope = keyof typeof PERMISSION_SCOPES;

export function isPermissionOfScope(key: string, scope: PermissionScope): boolean {
  return (PERMISSION_SCOPES[scope] as readonly string[]).includes(key);
}

/** Ações derivadas (não são permissões armazenadas; dependem do recurso). */
export const DERIVED_ACTIONS = [
  'item.read',
  'column.read',
  'column.update',
  'view.read',
  'view.update',
  'dashboard.read',
  'dashboard.update',
] as const;
export type DerivedAction = (typeof DERIVED_ACTIONS)[number];
export type Action = PermissionKey | DerivedAction;

/** Papéis de sistema (chaves estáveis; nomes exibidos vêm do banco/i18n). */
export const SYSTEM_TENANT_ROLES = ['owner', 'admin', 'member', 'viewer', 'guest'] as const;
export type SystemTenantRole = (typeof SYSTEM_TENANT_ROLES)[number];

const principalList = z
  .object({
    roleIds: z.array(z.uuid()).max(100).optional(),
    userIds: z.array(z.uuid()).max(1000).optional(),
    teamIds: z.array(z.uuid()).max(100).optional(),
  })
  .strict();

/** Restrições de uma coluna: quem vê e quem edita (listas vazias/ausentes = sem restrição). */
export const ColumnPermissionsSchema = z
  .object({ viewers: principalList.optional(), editors: principalList.optional() })
  .strict();
export type ColumnPermissions = z.infer<typeof ColumnPermissionsSchema>;
export type PrincipalList = z.infer<typeof principalList>;

export interface PrincipalAccess {
  userId: string;
  tenantId: string;
  kind: 'member' | 'guest';
  tenantRoleId: string;
  tenantRoleKey: string;
  tenantPermissions: readonly string[];
  teamIds: readonly string[];
}

export interface WorkspaceAccess {
  workspaceId: string;
  permissions: readonly string[];
}

export interface BoardAccess {
  boardId: string;
  workspaceId: string;
  /** Permissões efetivas no board (união de herança do workspace e concessões explícitas). */
  permissions: readonly string[];
  /** Ids dos papéis que se aplicam ao usuário no board (inclui o papel de tenant). */
  roleIds: readonly string[];
  /** Convidados veem apenas itens em que são responsáveis (padrão). */
  itemScope: 'all' | 'assigned';
  /** Colunas do tipo `people` usadas para determinar "responsável". */
  peopleColumnKeys: readonly string[];
}

export interface ColumnRef {
  key: string;
  permissions: ColumnPermissions;
  binding?: string | null;
}

export interface ItemRef {
  id: string;
  values: Readonly<Record<string, unknown>>;
  /** Permissões concedidas explicitamente neste item (access_grants resource_type = item). */
  grantPermissions?: readonly string[];
}

export interface ViewRef {
  id: string;
  ownerId: string | null;
  isRestricted: boolean;
  isLocked: boolean;
  /** Concessão explícita (access_grants resource_type = view) para o usuário ou seus times. */
  explicitGrant: boolean;
}

export interface DashboardRef {
  id: string;
  ownerId: string | null;
  visibility: 'private' | 'workspace';
}

export type ResourceRef =
  | { type: 'tenant' }
  | { type: 'workspace'; workspace: WorkspaceAccess | null }
  | { type: 'board'; board: BoardAccess | null }
  | { type: 'item'; board: BoardAccess | null; item: ItemRef }
  | { type: 'column'; board: BoardAccess | null; column: ColumnRef; item?: ItemRef }
  | { type: 'view'; board: BoardAccess | null; view: ViewRef }
  | { type: 'dashboard'; workspace: WorkspaceAccess | null; dashboard: DashboardRef };

const has = (list: readonly string[] | undefined, key: string) => list?.includes(key) ?? false;

function matchesPrincipalList(
  principal: PrincipalAccess,
  board: BoardAccess,
  list: PrincipalList | undefined,
): boolean {
  if (list === undefined) return true;
  const empty =
    (list.roleIds?.length ?? 0) + (list.userIds?.length ?? 0) + (list.teamIds?.length ?? 0) === 0;
  if (empty) return true;
  if (has(list.userIds, principal.userId)) return true;
  if (list.teamIds?.some((teamId) => principal.teamIds.includes(teamId)) === true) return true;
  return (
    list.roleIds?.some(
      (roleId) => roleId === principal.tenantRoleId || board.roleIds.includes(roleId),
    ) === true
  );
}

/** O usuário (ou um de seus times) está em alguma coluna de pessoas do item. */
export function isAssigned(principal: PrincipalAccess, board: BoardAccess, item: ItemRef): boolean {
  return board.peopleColumnKeys.some((key) => {
    const value = item.values[key];
    if (typeof value !== 'object' || value === null) return false;
    const { personIds, teamIds } = value as { personIds?: unknown; teamIds?: unknown };
    if (Array.isArray(personIds) && personIds.includes(principal.userId)) return true;
    return (
      Array.isArray(teamIds) && teamIds.some((teamId) => principal.teamIds.includes(String(teamId)))
    );
  });
}

function canReadItem(
  principal: PrincipalAccess,
  board: BoardAccess | null,
  item: ItemRef,
): boolean {
  if (has(item.grantPermissions, 'board.read')) return true;
  if (board === null || !has(board.permissions, 'board.read')) return false;
  return board.itemScope === 'all' || isAssigned(principal, board, item);
}

function canUpdateItem(
  principal: PrincipalAccess,
  board: BoardAccess | null,
  item: ItemRef,
): boolean {
  if (!canReadItem(principal, board, item)) return false;
  if (has(item.grantPermissions, 'item.update')) return true;
  if (board === null) return false;
  if (has(board.permissions, 'item.update')) return true;
  return has(board.permissions, 'item.update_assigned') && isAssigned(principal, board, item);
}

function canReadColumn(
  principal: PrincipalAccess,
  board: BoardAccess | null,
  column: ColumnRef,
): boolean {
  if (board === null) return false;
  if (has(board.permissions, 'board.manage')) return true;
  return matchesPrincipalList(principal, board, column.permissions.viewers);
}

/**
 * Decide se o usuário pode executar `action` sobre `resource`. Função pura e determinística.
 * Regras completas em docs/permissions.md.
 */
export function decide(principal: PrincipalAccess, action: Action, resource: ResourceRef): boolean {
  switch (resource.type) {
    case 'tenant':
      return has(principal.tenantPermissions, action);

    case 'workspace':
      return resource.workspace !== null && has(resource.workspace.permissions, action);

    case 'dashboard': {
      const { dashboard, workspace } = resource;
      const isOwner = dashboard.ownerId === principal.userId;
      const workspaceManager = workspace !== null && has(workspace.permissions, 'workspace.manage');
      if (action === 'dashboard.read') {
        if (isOwner) return true;
        return (
          dashboard.visibility === 'workspace' &&
          workspace !== null &&
          has(workspace.permissions, 'workspace.read')
        );
      }
      if (action === 'dashboard.update') return isOwner || workspaceManager;
      return false;
    }

    case 'board': {
      const { board } = resource;
      return board !== null && has(board.permissions, action);
    }

    case 'item': {
      const { board, item } = resource;
      if (action === 'item.read') return canReadItem(principal, board, item);
      if (action === 'item.update') return canUpdateItem(principal, board, item);
      if (!canReadItem(principal, board, item)) return false;
      return (
        has(item.grantPermissions, action) || (board !== null && has(board.permissions, action))
      );
    }

    case 'column': {
      const { board, column, item } = resource;
      if (action === 'column.read') {
        if (item !== undefined && !canReadItem(principal, board, item)) return false;
        return canReadColumn(principal, board, column);
      }
      if (action === 'column.update') {
        if (!canReadColumn(principal, board, column) || board === null) return false;
        if (item !== undefined && !canUpdateItem(principal, board, item)) return false;
        if (
          item === undefined &&
          !has(board.permissions, 'item.update') &&
          !has(board.permissions, 'item.update_assigned')
        ) {
          return false;
        }
        return (
          has(board.permissions, 'board.manage') ||
          matchesPrincipalList(principal, board, column.permissions.editors)
        );
      }
      if (action === 'column.manage')
        return board !== null && has(board.permissions, 'column.manage');
      return false;
    }

    case 'view': {
      const { board, view } = resource;
      if (board === null || !has(board.permissions, 'board.read')) return false;
      const isManager = has(board.permissions, 'board.manage');
      if (action === 'view.read') {
        if (view.ownerId !== null) return view.ownerId === principal.userId;
        return !view.isRestricted || view.explicitGrant || isManager;
      }
      if (action === 'view.update') {
        if (view.ownerId !== null) return view.ownerId === principal.userId;
        return has(board.permissions, 'view.manage') && (!view.isLocked || isManager);
      }
      return false;
    }
  }
}

/** Chaves de colunas que o usuário NÃO pode ler (para redação de valores). */
export function hiddenColumnKeys(
  principal: PrincipalAccess,
  board: BoardAccess | null,
  columns: readonly ColumnRef[],
): string[] {
  return columns
    .filter((column) => !decide(principal, 'column.read', { type: 'column', board, column }))
    .map((column) => column.key);
}
