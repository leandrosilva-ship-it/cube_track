import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { AutomationsService } from '../application/automations.service.js';
import * as S from './schemas.js';

/** CRUD de automações (ADR 0051): por board ou por workspace inteiro. */
@Controller()
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('boards/:boardId/automations')
  @Endpoint({
    summary: 'Listar automações do board',
    description: 'Requer `automation.manage` no board.',
    tags: ['automations'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.AutomationSchema) }),
  })
  async listForBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.automations.listForBoard(user, params.boardId) };
  }

  @Post('boards/:boardId/automations')
  @Audited({ action: 'automation.create', entityType: 'automation' })
  @Endpoint({
    summary: 'Criar automação de board',
    description: 'Requer `automation.manage` no board.',
    tags: ['automations'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateAutomationBody,
    response: S.AutomationSchema,
  })
  createForBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateAutomationBody>,
  ) {
    return this.automations.createForBoard(user, params.boardId, body);
  }

  @Get('workspaces/:workspaceId/automations')
  @Endpoint({
    summary: 'Listar automações de workspace inteiro',
    description: 'Requer `workspace.manage`. Não inclui automações de um board específico.',
    tags: ['automations'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.AutomationSchema) }),
  })
  async listForWorkspace(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
  ) {
    return { data: await this.automations.listForWorkspace(user, params.workspaceId) };
  }

  @Post('workspaces/:workspaceId/automations')
  @Audited({ action: 'automation.create', entityType: 'automation' })
  @Endpoint({
    summary: 'Criar automação de workspace inteiro',
    description: 'Requer `workspace.manage`. A automação se aplica a todos os boards do workspace.',
    tags: ['automations'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateAutomationBody,
    response: S.AutomationSchema,
  })
  createForWorkspace(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateAutomationBody>,
  ) {
    return this.automations.createForWorkspace(user, params.workspaceId, body);
  }

  @Patch('automations/:id')
  @Audited({ action: 'automation.update', entityType: 'automation' })
  @Endpoint({
    summary: 'Atualizar automação',
    tags: ['automations'],
    params: IdParams,
    body: S.UpdateAutomationBody,
    response: S.AutomationSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateAutomationBody>,
  ) {
    return this.automations.update(user, params.id, body);
  }

  @Delete('automations/:id')
  @Audited({ action: 'automation.delete', entityType: 'automation' })
  @Endpoint({ summary: 'Excluir automação', tags: ['automations'], params: IdParams, status: 204 })
  async remove(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.automations.remove(user, params.id);
  }

  @Post('automations/:id/duplicate')
  @Audited({ action: 'automation.duplicate', entityType: 'automation' })
  @Endpoint({
    summary: 'Duplicar automação (a cópia nasce desabilitada)',
    tags: ['automations'],
    status: 201,
    params: IdParams,
    response: S.AutomationSchema,
  })
  duplicate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return this.automations.duplicate(user, params.id);
  }
}
