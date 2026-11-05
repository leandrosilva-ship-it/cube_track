import { Injectable } from '@nestjs/common';
import {
  scimError,
  scimListResponse,
  SCIM_SCHEMAS,
  type ScimGroup,
  type ScimUser,
} from '@cube-track/shared';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { NotFoundError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { AccessAdminService } from '../../access/application/access-admin.service.js';
import { AccessService } from '../../access/application/access.service.js';
import { AuthService } from '../../identity/application/auth.service.js';
import { TeamsService } from '../../resources/application/teams.service.js';

export { scimError };

/**
 * Provisionamento SCIM 2.0 (ADR 0057) — superfície MÍNIMA (o bastante para um IdP corporativo
 * provisionar/desprovisionar usuários): sempre delega a ações de domínio reais (`AuthService`,
 * `AccessAdminService`), nunca SQL cru. `externalId`/atributos fora deste subconjunto são aceitos e
 * ignorados silenciosamente (não é um erro SCIM enviar mais do que consumimos).
 */
@Injectable()
export class ScimUsersService {
  constructor(
    private readonly admin: AccessAdminService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  async list(user: AuthPrincipal, startIndex: number, count: number) {
    await this.access.assert(user, 'members.invite', { type: 'tenant' });
    const members = await this.admin.listMembers();
    const page = members.slice(Math.max(startIndex - 1, 0), Math.max(startIndex - 1, 0) + count);
    return scimListResponse(page.map((member) => this.toScimUser(member)), members.length, startIndex);
  }

  async get(user: AuthPrincipal, userId: string): Promise<ScimUser> {
    await this.access.assert(user, 'members.invite', { type: 'tenant' });
    const member = (await this.admin.listMembers()).find((entry) => entry.userId === userId);
    if (member === undefined) throw new NotFoundError('Usuário SCIM', 'scim_user_not_found');
    return this.toScimUser(member);
  }

  /** Provisiona (ou reativa) um usuário com papel `member` — SCIM não carrega os papéis
   * customizados desta plataforma; ajuste fino de papel continua feito pela administração normal. */
  async create(user: AuthPrincipal, input: ScimUser): Promise<ScimUser> {
    await this.access.assert(user, 'members.manage', { type: 'tenant' });
    const email = input.emails[0]?.value;
    if (email === undefined) {
      throw new ValidationError([{ path: 'body.emails', message: 'Informe ao menos um e-mail.' }]);
    }
    const name = input.displayName ?? input.name?.formatted ?? email;
    const orgUnit =
      input['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']?.department ?? null;
    const provisioned = await this.auth.provisionExternalMember({
      tenantId: user.tenantId,
      email,
      name,
      roleKey: 'member',
      kind: 'member',
      orgUnit,
    });
    return this.toScimUser({
      userId: provisioned.id,
      name: provisioned.name,
      email: provisioned.email,
      kind: 'member',
      status: 'active',
      orgUnit,
    });
  }

  /** `active: false` desprovisiona (suspende); `active: true` reativa. Nome/departamento também
   * atualizáveis. Papel e convidado/membro não mudam por aqui (fora do escopo mínimo do SCIM). */
  async replace(user: AuthPrincipal, userId: string, input: ScimUser): Promise<ScimUser> {
    const orgUnit =
      input['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User']?.department ?? null;
    await this.admin.updateMember(user, userId, {
      status: input.active ? 'active' : 'suspended',
      orgUnit,
    });
    return this.get(user, userId);
  }

  /** PATCH simplificado: só o caminho `active` (desprovisionamento, o uso dominante de PATCH em
   * clientes SCIM reais) — demais operações respondem 501, nunca fingem aplicar algo que não aplicam. */
  async patch(
    user: AuthPrincipal,
    userId: string,
    operations: readonly { op: string; path?: string | undefined; value?: unknown }[],
  ): Promise<ScimUser> {
    for (const operation of operations) {
      if (operation.path === 'active' && typeof operation.value === 'boolean') {
        await this.admin.updateMember(user, userId, {
          status: operation.value ? 'active' : 'suspended',
        });
        continue;
      }
      throw new UnprocessableError(
        `Operação SCIM PATCH não suportada: ${operation.op} ${operation.path ?? ''}`.trim(),
        'scim_patch_unsupported',
      );
    }
    return this.get(user, userId);
  }

  /** SCIM DELETE = desprovisionar (suspender) — nunca exclusão definitiva (auditoria/outbox). */
  async deactivate(user: AuthPrincipal, userId: string): Promise<void> {
    await this.admin.updateMember(user, userId, { status: 'suspended' });
  }

  private toScimUser(member: {
    userId: string;
    name: string;
    email: string;
    kind: 'member' | 'guest';
    status: 'active' | 'invited' | 'suspended';
    orgUnit?: string | null;
  }): ScimUser {
    return {
      schemas: [SCIM_SCHEMAS.user],
      id: member.userId,
      userName: member.email,
      displayName: member.name,
      emails: [{ value: member.email, primary: true }],
      active: member.status === 'active',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User':
        member.orgUnit === null || member.orgUnit === undefined
          ? undefined
          : { department: member.orgUnit },
      meta: { resourceType: 'User' },
    };
  }
}

/** Grupos SCIM — somente leitura, espelhando `teams` (ADR 0052: CRUD de times é fora de escopo desde
 * aquele prompt; provisionar grupo por SCIM herdaria a mesma limitação, documentada honestamente). */
@Injectable()
export class ScimGroupsService {
  constructor(
    private readonly teams: TeamsService,
    private readonly access: AccessService,
  ) {}

  async list(user: AuthPrincipal, startIndex: number, count: number) {
    await this.access.assert(user, 'members.invite', { type: 'tenant' });
    const teams = await this.teams.list();
    const page = teams.slice(Math.max(startIndex - 1, 0), Math.max(startIndex - 1, 0) + count);
    return scimListResponse(page.map((team) => this.toScimGroup(team)), teams.length, startIndex);
  }

  async get(user: AuthPrincipal, groupId: string): Promise<ScimGroup> {
    await this.access.assert(user, 'members.invite', { type: 'tenant' });
    const team = (await this.teams.list()).find((entry) => entry.id === groupId);
    if (team === undefined) throw new NotFoundError('Grupo SCIM', 'scim_group_not_found');
    return this.toScimGroup(team);
  }

  private toScimGroup(team: { id: string; name: string }): ScimGroup {
    return { schemas: [SCIM_SCHEMAS.group], id: team.id, displayName: team.name, members: [] };
  }
}
