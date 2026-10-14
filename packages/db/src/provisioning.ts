import { newId, positionBetween } from '@cube-track/shared';

import type { Transaction } from './client.js';
import {
  dataRetentionPolicies,
  rolePermissions,
  roles,
  tenants,
  workCalendars,
} from './schema/index.js';

type RoleScope = 'tenant' | 'workspace' | 'board';

interface SystemRole {
  key: string;
  name: string;
  scope: RoleScope;
  description: string;
  permissions: readonly string[];
}

const BOARD_EDITOR = [
  'board.read',
  'board.export',
  'group.manage',
  'view.manage',
  'item.create',
  'item.update',
  'item.delete',
  'item.comment',
  'file.upload',
  'timesheet.log',
] as const;

/** Papéis de sistema criados em todo tenant (não editáveis; papéis customizados são adicionais). */
export const SYSTEM_ROLES: readonly SystemRole[] = [
  {
    key: 'owner',
    name: 'Proprietário',
    scope: 'tenant',
    description: 'Controle total da organização, inclusive plano e faturamento.',
    permissions: [
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
    ],
  },
  {
    key: 'admin',
    name: 'Administrador',
    scope: 'tenant',
    description: 'Administra membros, times, papéis, auditoria e integrações.',
    permissions: [
      'tenant.manage',
      'members.invite',
      'members.manage',
      'teams.manage',
      'roles.manage',
      'audit.read',
      'api_tokens.manage',
      'templates.manage',
      'workspace.create',
    ],
  },
  {
    key: 'member',
    name: 'Membro',
    scope: 'tenant',
    description: 'Participa dos workspaces aos quais tem acesso e pode criar workspaces.',
    permissions: ['workspace.create', 'members.invite'],
  },
  {
    key: 'viewer',
    name: 'Leitor',
    scope: 'tenant',
    description: 'Somente leitura nos recursos aos quais tem acesso.',
    permissions: [],
  },
  {
    key: 'guest',
    name: 'Convidado',
    scope: 'tenant',
    description: 'Usuário externo com acesso apenas a boards/itens compartilhados explicitamente.',
    permissions: [],
  },
  {
    key: 'workspace_admin',
    name: 'Administrador do workspace',
    scope: 'workspace',
    description: 'Gerencia o workspace, módulos, pastas, boards, portfólios e contratos.',
    permissions: [
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
    ],
  },
  {
    key: 'workspace_member',
    name: 'Membro do workspace',
    scope: 'workspace',
    description: 'Cria boards e dashboards no workspace.',
    permissions: [
      'workspace.read',
      'board.create',
      'dashboard.create',
      'portfolio.read',
      'contract.read',
    ],
  },
  {
    key: 'workspace_viewer',
    name: 'Leitor do workspace',
    scope: 'workspace',
    description: 'Visualiza o workspace.',
    permissions: ['workspace.read', 'portfolio.read'],
  },
  {
    key: 'board_owner',
    name: 'Dono do board',
    scope: 'board',
    description: 'Controle total do board.',
    permissions: [
      ...BOARD_EDITOR,
      'board.manage',
      'board.share',
      'column.manage',
      'automation.manage',
      'form.manage',
      'schedule.manage',
      'process.manage',
    ],
  },
  {
    key: 'board_editor',
    name: 'Editor',
    scope: 'board',
    description: 'Cria e edita itens, grupos e views.',
    permissions: BOARD_EDITOR,
  },
  {
    key: 'board_contributor',
    name: 'Colaborador',
    scope: 'board',
    description: 'Edita apenas itens em que é responsável e comenta (ideal para convidados).',
    permissions: [
      'board.read',
      'item.update_assigned',
      'item.comment',
      'file.upload',
      'timesheet.log',
    ],
  },
  {
    key: 'board_viewer',
    name: 'Leitor do board',
    scope: 'board',
    description: 'Visualiza o board e comenta.',
    permissions: ['board.read', 'item.comment'],
  },
];

export interface ProvisionTenantInput {
  id?: string;
  name: string;
  slug: string;
  legalName?: string;
  document?: string;
  timezone?: string;
  createdBy?: string;
  calendar?: { name: string; stateCode?: string; cityIbgeCode?: string };
}

export interface ProvisionedTenant {
  tenantId: string;
  roleIds: Record<string, string>;
  calendarId: string;
}

/**
 * Cria um tenant com papéis de sistema, calendário de trabalho padrão e políticas de retenção.
 * Deve rodar dentro de `withTenant` com o mesmo `tenantId` (o RLS exige o contexto).
 */
export async function provisionTenant(
  tx: Transaction,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  const tenantId = input.id ?? newId();
  const createdBy = input.createdBy ?? null;
  await tx.insert(tenants).values({
    id: tenantId,
    name: input.name,
    slug: input.slug,
    legalName: input.legalName ?? null,
    document: input.document ?? null,
    timezone: input.timezone ?? 'America/Sao_Paulo',
    createdBy,
  });

  const roleIds: Record<string, string> = {};
  for (const role of SYSTEM_ROLES) {
    const roleId = newId();
    roleIds[role.key] = roleId;
    await tx.insert(roles).values({
      id: roleId,
      tenantId,
      key: role.key,
      name: role.name,
      description: role.description,
      scope: role.scope,
      isSystem: true,
      createdBy,
    });
    if (role.permissions.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(
          role.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey, createdBy })),
        );
    }
  }

  const calendarId = newId();
  await tx.insert(workCalendars).values({
    id: calendarId,
    tenantId,
    name: input.calendar?.name ?? 'Calendário padrão',
    stateCode: input.calendar?.stateCode ?? null,
    cityIbgeCode: input.calendar?.cityIbgeCode ?? null,
    isDefault: true,
    createdBy,
  });

  await tx.insert(dataRetentionPolicies).values([
    {
      tenantId,
      entityType: 'audit_logs',
      retentionDays: 1825,
      action: 'archive',
      legalBasis: 'Cumprimento de obrigação legal/regulatória (LGPD art. 7º, II)',
      createdBy,
    },
    {
      tenantId,
      entityType: 'items.deleted',
      retentionDays: 30,
      action: 'delete',
      legalBasis: 'Lixeira — restauração pelo usuário',
      createdBy,
    },
    {
      tenantId,
      entityType: 'notifications',
      retentionDays: 180,
      action: 'delete',
      legalBasis: 'Minimização (LGPD art. 6º, III)',
      createdBy,
    },
    {
      tenantId,
      entityType: 'sessions',
      retentionDays: 90,
      action: 'delete',
      legalBasis: 'Segurança da informação',
      createdBy,
    },
  ]);

  return { tenantId, roleIds, calendarId };
}

/** Posição inicial para o primeiro elemento de uma lista. */
export const FIRST_POSITION = positionBetween(null, null);
