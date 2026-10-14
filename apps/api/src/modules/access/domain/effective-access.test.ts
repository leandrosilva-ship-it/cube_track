import { BOARD_PERMISSIONS, type PrincipalAccess } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import {
  buildRoleCatalog,
  computeBoardAccess,
  computeWorkspaceAccess,
  explicitPermissions,
  implicitWorkspaceRoleKey,
  inheritedBoardRoleKey,
  type BoardInput,
  type RoleDefinition,
} from './effective-access.js';

const role = (
  id: string,
  scope: RoleDefinition['scope'],
  key: string,
  permissions: string[],
): RoleDefinition => ({ id, scope, key, permissions });
const catalog = buildRoleCatalog([
  role('r-owner', 'tenant', 'owner', ['tenant.manage']),
  role('r-member', 'tenant', 'member', ['workspace.create']),
  role('r-viewer', 'tenant', 'viewer', []),
  role('r-guest', 'tenant', 'guest', []),
  role('w-admin', 'workspace', 'workspace_admin', [
    'workspace.read',
    'workspace.manage',
    'board.create',
  ]),
  role('w-member', 'workspace', 'workspace_member', ['workspace.read', 'board.create']),
  role('w-viewer', 'workspace', 'workspace_viewer', ['workspace.read']),
  role('b-owner', 'board', 'board_owner', [
    'board.read',
    'board.manage',
    'item.update',
    'column.manage',
  ]),
  role('b-editor', 'board', 'board_editor', ['board.read', 'item.create', 'item.update']),
  role('b-contrib', 'board', 'board_contributor', [
    'board.read',
    'item.update_assigned',
    'item.comment',
  ]),
  role('b-viewer', 'board', 'board_viewer', ['board.read', 'item.comment']),
]);

const principal = (
  roleKey: string,
  kind: 'member' | 'guest' = 'member',
  overrides: Partial<PrincipalAccess> = {},
): PrincipalAccess => ({
  userId: 'u1',
  tenantId: 't',
  kind,
  tenantRoleId: `r-${roleKey}`,
  tenantRoleKey: roleKey,
  tenantPermissions: catalog.byId.get(`r-${roleKey}`)?.permissions ?? [],
  teamIds: ['team-1'],
  ...overrides,
});

const board = (overrides: Partial<BoardInput> = {}): BoardInput => ({
  id: 'b1',
  workspaceId: 'w1',
  visibility: 'main',
  ownerId: null,
  guestItemVisibility: 'assigned',
  ...overrides,
});

describe('herança de acesso', () => {
  it('papel implícito de workspace por papel de tenant', () => {
    expect(implicitWorkspaceRoleKey(principal('member'))).toBe('workspace_member');
    expect(implicitWorkspaceRoleKey(principal('viewer'))).toBe('workspace_viewer');
    expect(implicitWorkspaceRoleKey(principal('guest', 'guest'))).toBeNull();
  });

  it('workspace aberto dá acesso implícito; fechado exige concessão', () => {
    expect(
      computeWorkspaceAccess(principal('member'), catalog, { id: 'w1', visibility: 'open' }, [])
        ?.permissions,
    ).toContain('board.create');
    expect(
      computeWorkspaceAccess(principal('member'), catalog, { id: 'w1', visibility: 'closed' }, []),
    ).toBeNull();
    const viaTeam = computeWorkspaceAccess(
      principal('member'),
      catalog,
      { id: 'w1', visibility: 'closed' },
      [{ roleId: 'w-viewer', principalType: 'team', principalId: 'team-1' }],
    );
    expect(viaTeam?.permissions).toEqual(['workspace.read']);
  });

  it('proprietário/administrador do tenant têm acesso total', () => {
    const access = computeBoardAccess(
      principal('owner'),
      catalog,
      null,
      board({ visibility: 'private' }),
      [],
      [],
    );
    expect(access?.permissions).toEqual([...BOARD_PERMISSIONS].sort());
  });

  it('board "main" herda do workspace: admin→dono, membro→editor, leitor→leitor', () => {
    expect(
      inheritedBoardRoleKey({
        workspaceId: 'w1',
        permissions: ['workspace.read', 'workspace.manage'],
      }),
    ).toBe('board_owner');
    const member = computeBoardAccess(
      principal('member'),
      catalog,
      { workspaceId: 'w1', permissions: ['workspace.read', 'board.create'] },
      board(),
      [],
      [],
    );
    expect(member?.permissions).toContain('item.update');
    expect(member?.roleIds).toContain('b-editor');
    const viewer = computeBoardAccess(
      principal('viewer'),
      catalog,
      { workspaceId: 'w1', permissions: ['workspace.read'] },
      board(),
      [],
      [],
    );
    expect(viewer?.permissions).not.toContain('item.update');
  });

  it('board privado ignora a herança; dono do board e concessões explícitas valem', () => {
    const workspace = { workspaceId: 'w1', permissions: ['workspace.read', 'board.create'] };
    expect(
      computeBoardAccess(
        principal('member'),
        catalog,
        workspace,
        board({ visibility: 'private' }),
        [],
        [],
      ),
    ).toBeNull();
    expect(
      computeBoardAccess(
        principal('member'),
        catalog,
        workspace,
        board({ visibility: 'private', ownerId: 'u1' }),
        [],
        [],
      )?.permissions,
    ).toContain('board.manage');
    const granted = computeBoardAccess(
      principal('member'),
      catalog,
      workspace,
      board({ visibility: 'private' }),
      [{ roleId: 'b-viewer', principalType: 'user', principalId: 'u1' }],
      [],
    );
    expect(granted?.permissions).toEqual(['board.read', 'item.comment']);
  });

  it('convidado: só concessões explícitas e escopo "assigned" por padrão', () => {
    const guest = principal('guest', 'guest');
    const workspace = { workspaceId: 'w1', permissions: ['workspace.read', 'board.create'] };
    expect(computeBoardAccess(guest, catalog, workspace, board(), [], ['c_people'])).toBeNull();
    const access = computeBoardAccess(
      guest,
      catalog,
      workspace,
      board(),
      [{ roleId: 'b-contrib', principalType: 'user', principalId: 'u1' }],
      ['c_people'],
    );
    expect(access?.itemScope).toBe('assigned');
    expect(access?.peopleColumnKeys).toEqual(['c_people']);
    const all = computeBoardAccess(
      guest,
      catalog,
      workspace,
      board({ guestItemVisibility: 'all' }),
      [{ roleId: 'b-contrib', principalType: 'user', principalId: 'u1' }],
      [],
    );
    expect(all?.itemScope).toBe('all');
  });

  it('concessões de outros usuários não se aplicam', () => {
    expect(
      explicitPermissions(principal('member'), catalog, [
        { roleId: 'b-owner', principalType: 'user', principalId: 'outro' },
      ]),
    ).toEqual([]);
    expect(
      explicitPermissions(principal('member'), catalog, [
        { roleId: 'b-viewer', principalType: 'team', principalId: 'team-1' },
      ]),
    ).toEqual(['board.read', 'item.comment']);
  });
});
