import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { ScimGroupsService, ScimUsersService } from '../application/scim-users.service.js';
import * as S from './schemas.js';

/**
 * SCIM 2.0 (ADR 0057) — fora do prefixo `/v1` (convenção do protocolo: `/scim/v2/...`), autenticado
 * pelo MESMO mecanismo de token de API (`Authorization: Bearer ctk_...`) já usado pelo resto da
 * plataforma; o teto de escopo (`scim:manage` → `members.invite`/`members.manage`,
 * `api-scope-map.ts`) garante que um token só provisiona o que seu dono já poderia administrar.
 */
@Controller('scim/v2')
export class ScimController {
  constructor(
    private readonly users: ScimUsersService,
    private readonly groups: ScimGroupsService,
  ) {}

  @Get('Users')
  @Endpoint({ summary: 'Listar usuários (SCIM 2.0)', tags: ['scim'], query: S.ScimListQuery })
  async listUsers(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.ScimListQuery>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.users.list(user, query.startIndex, query.count);
  }

  @Get('Users/:id')
  @Endpoint({ summary: 'Obter um usuário (SCIM 2.0)', tags: ['scim'], params: S.ScimIdParams })
  async getUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ScimIdParams>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.users.get(user, params.id);
  }

  @Post('Users')
  @HttpCode(201)
  @Audited({ action: 'scim.user_create', entityType: 'user' })
  @Endpoint({ summary: 'Provisionar um usuário (SCIM 2.0)', tags: ['scim'], body: S.ScimUserSchema })
  async createUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.ScimUserSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.users.create(user, body);
  }

  @Put('Users/:id')
  @Audited({ action: 'scim.user_replace', entityType: 'user' })
  @Endpoint({
    summary: 'Substituir um usuário — ativo/inativo e departamento (SCIM 2.0)',
    tags: ['scim'],
    params: S.ScimIdParams,
    body: S.ScimUserSchema,
  })
  async replaceUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ScimIdParams>,
    @Input('body') body: z.infer<typeof S.ScimUserSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.users.replace(user, params.id, body);
  }

  @Patch('Users/:id')
  @Audited({ action: 'scim.user_patch', entityType: 'user' })
  @Endpoint({
    summary: 'Aplicar operações PATCH — só `active` é suportado (SCIM 2.0)',
    tags: ['scim'],
    params: S.ScimIdParams,
    body: S.ScimPatchOperationSchema,
  })
  async patchUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ScimIdParams>,
    @Input('body') body: z.infer<typeof S.ScimPatchOperationSchema>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.users.patch(user, params.id, body.Operations);
  }

  @Delete('Users/:id')
  @HttpCode(204)
  @Audited({ action: 'scim.user_deactivate', entityType: 'user' })
  @Endpoint({
    summary: 'Desprovisionar (suspender) um usuário (SCIM 2.0)',
    tags: ['scim'],
    params: S.ScimIdParams,
    status: 204,
  })
  async deleteUser(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ScimIdParams>,
  ) {
    await this.users.deactivate(user, params.id);
  }

  @Get('Groups')
  @Endpoint({
    summary: 'Listar grupos (SCIM 2.0) — somente leitura, espelha os times (`teams`)',
    tags: ['scim'],
    query: S.ScimListQuery,
  })
  async listGroups(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.ScimListQuery>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.groups.list(user, query.startIndex, query.count);
  }

  @Get('Groups/:id')
  @Endpoint({ summary: 'Obter um grupo (SCIM 2.0)', tags: ['scim'], params: S.ScimIdParams })
  async getGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ScimIdParams>,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.type('application/scim+json');
    return this.groups.get(user, params.id);
  }
}
