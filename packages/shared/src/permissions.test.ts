import { describe, expect, it } from 'vitest';

import {
  BOARD_PERMISSIONS,
  decide,
  hiddenColumnKeys,
  isAssigned,
  isPermissionOfScope,
  type BoardAccess,
  type ColumnRef,
  type ItemRef,
  type PrincipalAccess,
  type ViewRef,
} from './permissions.js';

const USER = '01900000-0000-7000-8000-000000000001';
const OTHER = '01900000-0000-7000-8000-000000000002';
const TEAM = '01900000-0000-7000-8000-0000000000aa';
const TENANT_ROLE = '01900000-0000-7000-8000-0000000000r1';
const BOARD_ROLE = '01900000-0000-7000-8000-0000000000r2';
const OTHER_ROLE = '01900000-0000-7000-8000-0000000000r3';

const principal = (overrides: Partial<PrincipalAccess> = {}): PrincipalAccess => ({
  userId: USER,
  tenantId: 't',
  kind: 'member',
  tenantRoleId: TENANT_ROLE,
  tenantRoleKey: 'member',
  tenantPermissions: ['workspace.create'],
  teamIds: [],
  ...overrides,
});

const board = (permissions: string[], overrides: Partial<BoardAccess> = {}): BoardAccess => ({
  boardId: 'b',
  workspaceId: 'w',
  permissions,
  roleIds: [TENANT_ROLE, BOARD_ROLE],
  itemScope: 'all',
  peopleColumnKeys: ['c_people'],
  ...overrides,
});

const EDITOR = ['board.read', 'item.create', 'item.update', 'item.comment'];
const VIEWER = ['board.read', 'item.comment'];
const CONTRIBUTOR = ['board.read', 'item.update_assigned', 'item.comment'];
const MANAGER = [...BOARD_PERMISSIONS];

const item = (
  people: string[] = [],
  teams: string[] = [],
  extra: Partial<ItemRef> = {},
): ItemRef => ({
  id: 'i',
  values: { c_people: { personIds: people, teamIds: teams } },
  ...extra,
});

const column = (permissions: ColumnRef['permissions'] = {}): ColumnRef => ({
  key: 'c_ust',
  permissions,
});

describe('decide — tenant e workspace', () => {
  it('usa as permissões do papel de tenant', () => {
    expect(decide(principal(), 'workspace.create', { type: 'tenant' })).toBe(true);
    expect(decide(principal(), 'members.manage', { type: 'tenant' })).toBe(false);
  });

  it('nega workspace sem acesso e permite pelas permissões efetivas', () => {
    expect(decide(principal(), 'workspace.read', { type: 'workspace', workspace: null })).toBe(
      false,
    );
    const workspace = { workspaceId: 'w', permissions: ['workspace.read', 'board.create'] };
    expect(decide(principal(), 'board.create', { type: 'workspace', workspace })).toBe(true);
    expect(decide(principal(), 'workspace.manage', { type: 'workspace', workspace })).toBe(false);
  });
});

describe('decide — board', () => {
  it('nega tudo sem acesso ao board', () => {
    for (const permission of BOARD_PERMISSIONS) {
      expect(decide(principal(), permission, { type: 'board', board: null })).toBe(false);
    }
  });

  it.each([
    ['viewer', VIEWER, { read: true, create: false, manage: false }],
    ['editor', EDITOR, { read: true, create: true, manage: false }],
    ['manager', MANAGER, { read: true, create: true, manage: true }],
  ])('papel %s', (_name, permissions, expected) => {
    const access = board(permissions);
    expect(decide(principal(), 'board.read', { type: 'board', board: access })).toBe(expected.read);
    expect(decide(principal(), 'item.create', { type: 'board', board: access })).toBe(
      expected.create,
    );
    expect(decide(principal(), 'board.manage', { type: 'board', board: access })).toBe(
      expected.manage,
    );
  });
});

describe('decide — item', () => {
  it('editor lê e altera qualquer item', () => {
    const access = board(EDITOR);
    expect(decide(principal(), 'item.read', { type: 'item', board: access, item: item() })).toBe(
      true,
    );
    expect(decide(principal(), 'item.update', { type: 'item', board: access, item: item() })).toBe(
      true,
    );
  });

  it('leitor lê mas não altera', () => {
    const access = board(VIEWER);
    expect(decide(principal(), 'item.read', { type: 'item', board: access, item: item() })).toBe(
      true,
    );
    expect(decide(principal(), 'item.update', { type: 'item', board: access, item: item() })).toBe(
      false,
    );
    expect(decide(principal(), 'item.comment', { type: 'item', board: access, item: item() })).toBe(
      true,
    );
  });

  it('colaborador altera apenas itens em que é responsável (direto ou por time)', () => {
    const access = board(CONTRIBUTOR);
    expect(
      decide(principal(), 'item.update', { type: 'item', board: access, item: item([OTHER]) }),
    ).toBe(false);
    expect(
      decide(principal(), 'item.update', { type: 'item', board: access, item: item([USER]) }),
    ).toBe(true);
    expect(
      decide(principal({ teamIds: [TEAM] }), 'item.update', {
        type: 'item',
        board: access,
        item: item([], [TEAM]),
      }),
    ).toBe(true);
  });

  it('convidado com escopo "assigned" só vê itens atribuídos', () => {
    const guest = principal({ kind: 'guest', tenantRoleKey: 'guest', tenantPermissions: [] });
    const access = board(CONTRIBUTOR, { itemScope: 'assigned' });
    expect(decide(guest, 'item.read', { type: 'item', board: access, item: item([OTHER]) })).toBe(
      false,
    );
    expect(decide(guest, 'item.read', { type: 'item', board: access, item: item([USER]) })).toBe(
      true,
    );
    expect(
      decide(guest, 'item.comment', { type: 'item', board: access, item: item([OTHER]) }),
    ).toBe(false);
  });

  it('concessão explícita no item dá acesso sem acesso ao board', () => {
    const shared = item([], [], { grantPermissions: ['board.read', 'item.comment'] });
    expect(decide(principal(), 'item.read', { type: 'item', board: null, item: shared })).toBe(
      true,
    );
    expect(decide(principal(), 'item.comment', { type: 'item', board: null, item: shared })).toBe(
      true,
    );
    expect(decide(principal(), 'item.update', { type: 'item', board: null, item: shared })).toBe(
      false,
    );
    const editable = item([], [], { grantPermissions: ['board.read', 'item.update'] });
    expect(decide(principal(), 'item.update', { type: 'item', board: null, item: editable })).toBe(
      true,
    );
  });

  it('ignora valores de pessoas malformados', () => {
    const access = board(CONTRIBUTOR);
    const weird: ItemRef = { id: 'i', values: { c_people: 'x' } };
    expect(isAssigned(principal(), access, weird)).toBe(false);
  });
});

describe('decide — coluna', () => {
  it('coluna sem restrição é visível e editável por quem edita o item', () => {
    const access = board(EDITOR);
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: column() }),
    ).toBe(true);
    expect(
      decide(principal(), 'column.update', {
        type: 'column',
        board: access,
        column: column(),
        item: item(),
      }),
    ).toBe(true);
  });

  it('restrição de leitura por usuário, time e papel', () => {
    const access = board(EDITOR);
    const byUser = column({ viewers: { userIds: [OTHER] } });
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: byUser }),
    ).toBe(false);
    expect(
      decide(principal({ userId: OTHER }), 'column.read', {
        type: 'column',
        board: access,
        column: byUser,
      }),
    ).toBe(true);

    const byTeam = column({ viewers: { teamIds: [TEAM] } });
    expect(
      decide(principal({ teamIds: [TEAM] }), 'column.read', {
        type: 'column',
        board: access,
        column: byTeam,
      }),
    ).toBe(true);

    const byBoardRole = column({ viewers: { roleIds: [BOARD_ROLE] } });
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: byBoardRole }),
    ).toBe(true);
    const byOtherRole = column({ viewers: { roleIds: [OTHER_ROLE] } });
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: byOtherRole }),
    ).toBe(false);
  });

  it('quem gerencia o board ignora restrições de coluna', () => {
    const restricted = column({ viewers: { userIds: [OTHER] }, editors: { userIds: [OTHER] } });
    const access = board(MANAGER);
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: restricted }),
    ).toBe(true);
    expect(
      decide(principal(), 'column.update', {
        type: 'column',
        board: access,
        column: restricted,
        item: item(),
      }),
    ).toBe(true);
  });

  it('restrição de edição não afeta leitura', () => {
    const access = board(EDITOR);
    const editors = column({ editors: { userIds: [OTHER] } });
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: editors }),
    ).toBe(true);
    expect(
      decide(principal(), 'column.update', {
        type: 'column',
        board: access,
        column: editors,
        item: item(),
      }),
    ).toBe(false);
  });

  it('não edita coluna que não pode ler, nem item que não pode alterar', () => {
    const access = board(EDITOR);
    const hidden = column({ viewers: { userIds: [OTHER] } });
    expect(
      decide(principal(), 'column.update', {
        type: 'column',
        board: access,
        column: hidden,
        item: item(),
      }),
    ).toBe(false);
    expect(
      decide(principal(), 'column.update', {
        type: 'column',
        board: board(VIEWER),
        column: column(),
        item: item(),
      }),
    ).toBe(false);
  });

  it('não lê coluna de item invisível', () => {
    const access = board(CONTRIBUTOR, { itemScope: 'assigned' });
    expect(
      decide(principal(), 'column.read', {
        type: 'column',
        board: access,
        column: column(),
        item: item([OTHER]),
      }),
    ).toBe(false);
  });

  it('listas vazias equivalem a sem restrição', () => {
    const access = board(EDITOR);
    const empty = column({ viewers: { userIds: [], teamIds: [], roleIds: [] } });
    expect(
      decide(principal(), 'column.read', { type: 'column', board: access, column: empty }),
    ).toBe(true);
  });

  it('hiddenColumnKeys lista apenas colunas não legíveis', () => {
    const access = board(EDITOR);
    const columns: ColumnRef[] = [
      { key: 'c_a', permissions: {} },
      { key: 'c_b', permissions: { viewers: { userIds: [OTHER] } } },
    ];
    expect(hiddenColumnKeys(principal(), access, columns)).toEqual(['c_b']);
    expect(hiddenColumnKeys(principal(), null, columns)).toEqual(['c_a', 'c_b']);
  });
});

describe('decide — view', () => {
  const view = (overrides: Partial<ViewRef> = {}): ViewRef => ({
    id: 'v',
    ownerId: null,
    isRestricted: false,
    isLocked: false,
    explicitGrant: false,
    ...overrides,
  });

  it('view pessoal só para o dono', () => {
    const access = board(MANAGER);
    expect(
      decide(principal(), 'view.read', {
        type: 'view',
        board: access,
        view: view({ ownerId: OTHER }),
      }),
    ).toBe(false);
    expect(
      decide(principal(), 'view.read', {
        type: 'view',
        board: access,
        view: view({ ownerId: USER }),
      }),
    ).toBe(true);
    expect(
      decide(principal(), 'view.update', {
        type: 'view',
        board: access,
        view: view({ ownerId: USER }),
      }),
    ).toBe(true);
  });

  it('view compartilhada restrita exige concessão ou gestão do board', () => {
    expect(
      decide(principal(), 'view.read', {
        type: 'view',
        board: board(EDITOR),
        view: view({ isRestricted: true }),
      }),
    ).toBe(false);
    expect(
      decide(principal(), 'view.read', {
        type: 'view',
        board: board(EDITOR),
        view: view({ isRestricted: true, explicitGrant: true }),
      }),
    ).toBe(true);
    expect(
      decide(principal(), 'view.read', {
        type: 'view',
        board: board(MANAGER),
        view: view({ isRestricted: true }),
      }),
    ).toBe(true);
  });

  it('editar view compartilhada exige view.manage; travada exige board.manage', () => {
    expect(
      decide(principal(), 'view.update', { type: 'view', board: board(EDITOR), view: view() }),
    ).toBe(false);
    expect(
      decide(principal(), 'view.update', {
        type: 'view',
        board: board([...EDITOR, 'view.manage']),
        view: view(),
      }),
    ).toBe(true);
    expect(
      decide(principal(), 'view.update', {
        type: 'view',
        board: board([...EDITOR, 'view.manage']),
        view: view({ isLocked: true }),
      }),
    ).toBe(false);
    expect(
      decide(principal(), 'view.update', {
        type: 'view',
        board: board(MANAGER),
        view: view({ isLocked: true }),
      }),
    ).toBe(true);
  });

  it('sem acesso ao board não há view', () => {
    expect(decide(principal(), 'view.read', { type: 'view', board: null, view: view() })).toBe(
      false,
    );
  });
});

describe('decide — dashboard', () => {
  const workspace = { workspaceId: 'w', permissions: ['workspace.read'] };
  it('privado só para o dono; workspace para quem lê o workspace', () => {
    const dashboard = { id: 'd', ownerId: OTHER, visibility: 'private' as const };
    expect(decide(principal(), 'dashboard.read', { type: 'dashboard', workspace, dashboard })).toBe(
      false,
    );
    expect(
      decide(principal(), 'dashboard.read', {
        type: 'dashboard',
        workspace,
        dashboard: { ...dashboard, visibility: 'workspace' },
      }),
    ).toBe(true);
    expect(
      decide(principal(), 'dashboard.update', {
        type: 'dashboard',
        workspace,
        dashboard: { ...dashboard, visibility: 'workspace' },
      }),
    ).toBe(false);
    expect(
      decide(principal({ userId: OTHER }), 'dashboard.update', {
        type: 'dashboard',
        workspace,
        dashboard,
      }),
    ).toBe(true);
  });
});

describe('catálogo', () => {
  it('classifica permissões por escopo', () => {
    expect(isPermissionOfScope('board.read', 'board')).toBe(true);
    expect(isPermissionOfScope('board.read', 'workspace')).toBe(false);
    expect(isPermissionOfScope('tenant.manage', 'tenant')).toBe(true);
  });
});
