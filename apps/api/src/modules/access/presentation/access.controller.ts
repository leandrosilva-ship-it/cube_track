import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import {
  BOARD_PERMISSIONS,
  DERIVED_ACTIONS,
  TENANT_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
} from '@cube-track/shared';
import { z } from 'zod';

import { Audited, ReadOnlyOperation } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { AccessAdminService } from '../application/access-admin.service.js';
import { AccessService } from '../application/access.service.js';

const ALL_ACTIONS = [
  ...TENANT_PERMISSIONS,
  ...WORKSPACE_PERMISSIONS,
  ...BOARD_PERMISSIONS,
  ...DERIVED_ACTIONS,
] as const;

const RoleSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  scope: z.enum(['tenant', 'workspace', 'board']),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
});
const CreateRoleBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  scope: z.enum(['tenant', 'workspace', 'board']),
  permissions: z.array(z.string()).max(100),
});
const UpdateRoleBody = CreateRoleBody.pick({
  name: true,
  description: true,
  permissions: true,
}).partial();

const GrantSchema = z.object({
  id: z.uuid(),
  resourceType: z.enum(['workspace', 'board', 'view', 'item']),
  resourceId: z.uuid(),
  principalType: z.enum(['user', 'team']),
  principalId: z.uuid(),
  roleId: z.uuid(),
  expiresAt: z.union([z.string(), z.date()]).nullable(),
});
const GrantQuery = z.object({
  resourceType: z.enum(['workspace', 'board', 'view', 'item']),
  resourceId: z.uuid(),
});
const CreateGrantBody = z.object({
  resourceType: z.enum(['workspace', 'board', 'view', 'item']),
  resourceId: z.uuid(),
  principalType: z.enum(['user', 'team']),
  principalId: z.uuid(),
  roleId: z.uuid(),
  expiresAt: z.iso.datetime().optional(),
});

const MemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  kind: z.enum(['member', 'guest']),
  status: z.enum(['active', 'invited', 'suspended']),
  roleId: z.uuid(),
  jobTitle: z.string().nullable(),
});
const UserParams = z.object({ userId: z.uuid() });
const UpdateMemberBody = z.object({
  roleId: z.uuid().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

const CheckBody = z.object({
  action: z.enum(ALL_ACTIONS),
  resource: z.discriminatedUnion('type', [
    z.object({ type: z.literal('tenant') }),
    z.object({ type: z.literal('workspace'), id: z.uuid() }),
    z.object({ type: z.literal('board'), id: z.uuid() }),
    z.object({ type: z.literal('view'), id: z.uuid() }),
    z.object({ type: z.literal('dashboard'), id: z.uuid() }),
    z.object({ type: z.literal('column'), boardId: z.uuid(), key: z.string() }),
  ]),
});
const BoardPermissionsQuery = z.object({ boardId: z.uuid() });

@Controller()
export class AccessController {
  constructor(
    private readonly admin: AccessAdminService,
    private readonly access: AccessService,
  ) {}

  @Get('roles')
  @Endpoint({
    summary: 'Listar papéis (sistema e customizados)',
    tags: ['access'],
    response: z.object({ data: z.array(RoleSchema) }),
  })
  async listRoles() {
    return { data: await this.admin.listRoles() };
  }

  @Post('roles')
  @Audited({ action: 'role.create', entityType: 'role' })
  @Endpoint({
    summary: 'Criar papel customizado',
    tags: ['access'],
    status: 201,
    body: CreateRoleBody,
    response: RoleSchema,
  })
  createRole(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof CreateRoleBody>,
  ) {
    return this.admin.createRole(user, body);
  }

  @Patch('roles/:id')
  @Audited({ action: 'role.update', entityType: 'role' })
  @Endpoint({
    summary: 'Atualizar papel customizado',
    tags: ['access'],
    params: IdParams,
    body: UpdateRoleBody,
  })
  updateRole(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: { id: string },
    @Input('body') body: z.infer<typeof UpdateRoleBody>,
  ) {
    return this.admin.updateRole(user, params.id, body);
  }

  @Delete('roles/:id')
  @Audited({ action: 'role.delete', entityType: 'role' })
  @Endpoint({
    summary: 'Excluir papel customizado',
    tags: ['access'],
    status: 204,
    params: IdParams,
    errors: [409],
  })
  async deleteRole(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: { id: string },
  ) {
    await this.admin.deleteRole(user, params.id);
  }

  @Get('access-grants')
  @Endpoint({
    summary: 'Listar concessões de um recurso',
    tags: ['access'],
    query: GrantQuery,
    response: z.object({ data: z.array(GrantSchema) }),
  })
  async listGrants(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof GrantQuery>,
  ) {
    return { data: await this.admin.listGrants(user, query.resourceType, query.resourceId) };
  }

  @Post('access-grants')
  @Audited({ action: 'access_grant.create', entityType: 'access_grant' })
  @Endpoint({
    summary: 'Conceder acesso (workspace, board, view ou item)',
    tags: ['access'],
    status: 201,
    body: CreateGrantBody,
    response: GrantSchema,
  })
  createGrant(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof CreateGrantBody>,
  ) {
    return this.admin.createGrant(user, body);
  }

  @Delete('access-grants/:id')
  @Audited({ action: 'access_grant.delete', entityType: 'access_grant' })
  @Endpoint({ summary: 'Revogar concessão', tags: ['access'], status: 204, params: IdParams })
  async deleteGrant(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: { id: string },
  ) {
    await this.admin.deleteGrant(user, params.id);
  }

  @Get('members')
  @Endpoint({
    summary: 'Listar membros e convidados',
    tags: ['access'],
    response: z.object({ data: z.array(MemberSchema) }),
  })
  async listMembers() {
    return { data: await this.admin.listMembers() };
  }

  @Patch('members/:userId')
  @Audited({ action: 'membership.update', entityType: 'membership' })
  @Endpoint({
    summary: 'Alterar papel ou status de um membro',
    tags: ['access'],
    params: UserParams,
    body: UpdateMemberBody,
  })
  updateMember(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof UserParams>,
    @Input('body') body: z.infer<typeof UpdateMemberBody>,
  ) {
    return this.admin.updateMember(user, params.userId, body);
  }

  @Post('access/check')
  @ReadOnlyOperation()
  @Endpoint({
    summary: 'Verificar uma permissão (can)',
    description: 'Avalia `can(usuário, ação, recurso)` com as regras de RBAC em 5 níveis.',
    tags: ['access'],
    status: 200,
    body: CheckBody,
    response: z.object({ allowed: z.boolean() }),
  })
  async check(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof CheckBody>,
  ) {
    return { allowed: await this.access.can(user, body.action, body.resource) };
  }

  @Get('me/permissions')
  @Endpoint({
    summary: 'Permissões efetivas no board e colunas ocultas',
    tags: ['access'],
    query: BoardPermissionsQuery,
    response: z.object({
      permissions: z.array(z.string()),
      itemScope: z.enum(['all', 'assigned']).nullable(),
      hiddenColumnKeys: z.array(z.string()),
    }),
  })
  async myPermissions(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof BoardPermissionsQuery>,
  ) {
    const board = await this.access.board(user, query.boardId);
    const { hidden } = await this.access.hiddenColumns(user, query.boardId);
    return {
      permissions: [...(board?.permissions ?? [])],
      itemScope: board?.itemScope ?? null,
      hiddenColumnKeys: [...hidden],
    };
  }
}
