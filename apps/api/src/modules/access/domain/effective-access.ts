import {
  BOARD_PERMISSIONS,
  GUEST_ORG_COLUMN_TYPES,
  WORKSPACE_PERMISSIONS,
  type BoardAccess,
  type PrincipalAccess,
  type WorkspaceAccess,
} from '@cube-track/shared';

/**
 * Cálculo das permissões efetivas (herança workspace → board + concessões explícitas).
 * Regras documentadas em docs/permissions.md §3. Funções puras, testadas isoladamente.
 */

export interface RoleDefinition {
  id: string;
  key: string;
  scope: 'tenant' | 'workspace' | 'board';
  permissions: readonly string[];
}

export interface GrantRow {
  roleId: string;
  principalType: 'user' | 'team';
  principalId: string;
}

export interface RoleCatalog {
  byId: ReadonlyMap<string, RoleDefinition>;
  byKey: ReadonlyMap<string, RoleDefinition>;
}

export function buildRoleCatalog(roles: readonly RoleDefinition[]): RoleCatalog {
  return {
    byId: new Map(roles.map((role) => [role.id, role])),
    // Chave composta escopo:chave (a mesma chave pode existir em escopos diferentes).
    byKey: new Map(roles.map((role) => [`${role.scope}:${role.key}`, role])),
  };
}

const TENANT_SUPERUSERS = new Set(['owner', 'admin']);

export function isTenantSuperuser(principal: PrincipalAccess): boolean {
  return principal.kind === 'member' && TENANT_SUPERUSERS.has(principal.tenantRoleKey);
}

function grantsFor(principal: PrincipalAccess, grants: readonly GrantRow[]): GrantRow[] {
  return grants.filter(
    (grant) =>
      (grant.principalType === 'user' && grant.principalId === principal.userId) ||
      (grant.principalType === 'team' && principal.teamIds.includes(grant.principalId)),
  );
}

function role(
  catalog: RoleCatalog,
  scope: RoleDefinition['scope'],
  key: string,
): RoleDefinition | undefined {
  return catalog.byKey.get(`${scope}:${key}`);
}

/** Papel implícito de workspace para membros em workspaces abertos. */
export function implicitWorkspaceRoleKey(principal: PrincipalAccess): string | null {
  if (principal.kind !== 'member') return null;
  if (principal.tenantRoleKey === 'viewer') return 'workspace_viewer';
  if (
    principal.tenantRoleKey === 'member' ||
    principal.tenantPermissions.includes('workspace.create')
  )
    return 'workspace_member';
  return 'workspace_viewer';
}

export interface WorkspaceInput {
  id: string;
  visibility: 'open' | 'closed';
}

export function computeWorkspaceAccess(
  principal: PrincipalAccess,
  catalog: RoleCatalog,
  workspace: WorkspaceInput,
  grants: readonly GrantRow[],
): WorkspaceAccess | null {
  if (isTenantSuperuser(principal))
    return { workspaceId: workspace.id, permissions: [...WORKSPACE_PERMISSIONS] };
  const permissions = new Set<string>();
  for (const grant of grantsFor(principal, grants)) {
    catalog.byId
      .get(grant.roleId)
      ?.permissions.forEach((permission) => permissions.add(permission));
  }
  if (workspace.visibility === 'open') {
    const implicitKey = implicitWorkspaceRoleKey(principal);
    if (implicitKey !== null)
      role(catalog, 'workspace', implicitKey)?.permissions.forEach((permission) =>
        permissions.add(permission),
      );
  }
  return permissions.has('workspace.read')
    ? { workspaceId: workspace.id, permissions: [...permissions].sort() }
    : null;
}

export interface BoardInput {
  id: string;
  workspaceId: string;
  visibility: 'main' | 'private' | 'shareable';
  ownerId: string | null;
  guestItemVisibility: 'assigned' | 'all' | 'org';
  /** Id (não a chave) da coluna de órgão/departamento, quando `guestItemVisibility === 'org'`. */
  guestOrgColumnId: string | null;
}

/** Papel de board herdado das permissões do workspace (boards `main`). */
export function inheritedBoardRoleKey(workspace: WorkspaceAccess | null): string | null {
  if (workspace === null) return null;
  if (workspace.permissions.includes('workspace.manage')) return 'board_owner';
  if (workspace.permissions.includes('board.create')) return 'board_editor';
  if (workspace.permissions.includes('workspace.read')) return 'board_viewer';
  return null;
}

export function computeBoardAccess(
  principal: PrincipalAccess,
  catalog: RoleCatalog,
  workspace: WorkspaceAccess | null,
  board: BoardInput,
  grants: readonly GrantRow[],
  peopleColumnKeys: readonly string[],
  /** Coluna apontada por `board.guestOrgColumnId`, já resolvida pelo chamador (ou `null` se o id não
   * corresponder a nenhuma coluna existente do board — coluna excluída após configurada). */
  guestOrgColumn: { key: string; type: string } | null = null,
): BoardAccess | null {
  const permissions = new Set<string>();
  const roleIds = new Set<string>([principal.tenantRoleId]);
  const addRole = (definition: RoleDefinition | undefined) => {
    if (definition === undefined) return;
    roleIds.add(definition.id);
    definition.permissions.forEach((permission) => permissions.add(permission));
  };

  if (isTenantSuperuser(principal)) {
    BOARD_PERMISSIONS.forEach((permission) => permissions.add(permission));
  } else {
    for (const grant of grantsFor(principal, grants)) addRole(catalog.byId.get(grant.roleId));
    if (board.ownerId === principal.userId) addRole(role(catalog, 'board', 'board_owner'));
    if (board.visibility === 'main' && principal.kind === 'member') {
      const inherited = inheritedBoardRoleKey(workspace);
      if (inherited !== null) addRole(role(catalog, 'board', inherited));
    }
  }
  if (!permissions.has('board.read')) return null;

  // Visibilidade de item para convidado (ADR 0057). Fail-safe: qualquer configuração incompleta ou
  // inválida cai no escopo mais restrito já existente (`assigned`), NUNCA em `all`.
  let itemScope: BoardAccess['itemScope'] = 'all';
  let guestOrgColumnKey: string | null = null;
  let guestOrgUnit: string | null = null;
  if (principal.kind === 'guest') {
    if (board.guestItemVisibility === 'org') {
      const orgUnit = principal.orgUnit?.trim() ?? '';
      if (
        board.guestOrgColumnId !== null &&
        guestOrgColumn !== null &&
        (GUEST_ORG_COLUMN_TYPES as readonly string[]).includes(guestOrgColumn.type) &&
        orgUnit !== ''
      ) {
        itemScope = 'org';
        guestOrgColumnKey = guestOrgColumn.key;
        guestOrgUnit = orgUnit;
      } else {
        itemScope = 'assigned';
      }
    } else if (board.guestItemVisibility !== 'all') {
      itemScope = 'assigned';
    }
  }

  return {
    boardId: board.id,
    workspaceId: board.workspaceId,
    permissions: [...permissions].sort(),
    roleIds: [...roleIds].sort(),
    itemScope,
    peopleColumnKeys: [...peopleColumnKeys],
    guestOrgColumnKey,
    guestOrgUnit,
  };
}

/** Permissões concedidas explicitamente sobre um item/view para o usuário (ou seus times). */
export function explicitPermissions(
  principal: PrincipalAccess,
  catalog: RoleCatalog,
  grants: readonly GrantRow[],
): string[] {
  const permissions = new Set<string>();
  for (const grant of grantsFor(principal, grants)) {
    catalog.byId
      .get(grant.roleId)
      ?.permissions.forEach((permission) => permissions.add(permission));
  }
  return [...permissions].sort();
}
