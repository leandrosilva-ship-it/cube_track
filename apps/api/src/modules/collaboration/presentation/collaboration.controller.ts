import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { ActivityService } from '../application/activity.service.js';
import { ApprovalsService } from '../application/approvals.service.js';
import { ChecklistsService } from '../application/checklists.service.js';
import { FollowsService } from '../application/follows.service.js';
import { UpdatesService } from '../application/updates.service.js';
import * as S from './schemas.js';

@Controller()
export class CollaborationController {
  constructor(
    private readonly updates: UpdatesService,
    private readonly activity: ActivityService,
    private readonly checklists: ChecklistsService,
    private readonly follows: FollowsService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ---------------------------------------------------------------------------- updates ---

  @Get('items/:id/updates')
  @Endpoint({
    summary: 'Feed de atualizações do item (fixadas + paginação por cursor)',
    tags: ['collaboration'],
    params: IdParams,
    query: S.FeedQuerySchema,
  })
  feed(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('query') query: z.infer<typeof S.FeedQuerySchema>,
  ) {
    return this.updates.listFeed(user, params.id, query);
  }

  @Post('items/:id/updates')
  @Audited({ action: 'update.create', entityType: 'update' })
  @Endpoint({
    summary: 'Postar uma atualização no item',
    tags: ['collaboration'],
    status: 201,
    params: IdParams,
    body: S.UpdateBodySchema,
  })
  createUpdate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateBodySchema>,
  ) {
    return this.updates.createUpdate(user, params.id, body.body);
  }

  @Patch('updates/:id')
  @Audited({ action: 'update.edit', entityType: 'update' })
  @Endpoint({
    summary: 'Editar uma atualização (guarda histórico)',
    tags: ['collaboration'],
    params: IdParams,
    body: S.UpdateBodySchema,
  })
  editUpdate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateBodySchema>,
  ) {
    return this.updates.editUpdate(user, params.id, body.body);
  }

  @Delete('updates/:id')
  @Audited({ action: 'update.delete', entityType: 'update' })
  @Endpoint({
    summary: 'Excluir uma atualização',
    tags: ['collaboration'],
    status: 204,
    params: IdParams,
  })
  async deleteUpdate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.updates.deleteUpdate(user, params.id);
  }

  @Post('updates/:id/pin')
  @Audited({ action: 'update.pin', entityType: 'update' })
  @Endpoint({
    summary: 'Fixar ou desafixar uma atualização',
    tags: ['collaboration'],
    status: 200,
    params: IdParams,
    body: S.PinBodySchema,
  })
  pinUpdate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.PinBodySchema>,
  ) {
    return this.updates.setPinned(user, params.id, body.pinned);
  }

  @Get('updates/:id/replies')
  @Endpoint({ summary: 'Respostas de uma atualização', tags: ['collaboration'], params: IdParams })
  async listReplies(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return { data: await this.updates.listReplies(user, params.id) };
  }

  @Post('updates/:id/replies')
  @Audited({ action: 'reply.create', entityType: 'reply' })
  @Endpoint({
    summary: 'Responder a uma atualização',
    tags: ['collaboration'],
    status: 201,
    params: IdParams,
    body: S.UpdateBodySchema,
  })
  createReply(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateBodySchema>,
  ) {
    return this.updates.createReply(user, params.id, body.body);
  }

  @Patch('replies/:id')
  @Audited({ action: 'reply.edit', entityType: 'reply' })
  @Endpoint({
    summary: 'Editar uma resposta (guarda histórico)',
    tags: ['collaboration'],
    params: IdParams,
    body: S.UpdateBodySchema,
  })
  editReply(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateBodySchema>,
  ) {
    return this.updates.editReply(user, params.id, body.body);
  }

  @Delete('replies/:id')
  @Audited({ action: 'reply.delete', entityType: 'reply' })
  @Endpoint({ summary: 'Excluir uma resposta', tags: ['collaboration'], status: 204, params: IdParams })
  async deleteReply(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.updates.deleteReply(user, params.id);
  }

  @Post('updates/:id/reactions')
  @Audited({ action: 'reaction.toggle', entityType: 'update' })
  @Endpoint({
    summary: 'Alternar uma reação (emoji) numa atualização',
    tags: ['collaboration'],
    status: 200,
    params: S.ReactionParams,
    body: S.ReactionBodySchema,
  })
  async reactUpdate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ReactionParams>,
    @Input('body') body: z.infer<typeof S.ReactionBodySchema>,
  ) {
    return { data: await this.updates.toggleReaction(user, 'update', params.id, body.emoji) };
  }

  @Post('replies/:id/reactions')
  @Audited({ action: 'reaction.toggle', entityType: 'reply' })
  @Endpoint({
    summary: 'Alternar uma reação (emoji) numa resposta',
    tags: ['collaboration'],
    status: 200,
    params: S.ReactionParams,
    body: S.ReactionBodySchema,
  })
  async reactReply(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ReactionParams>,
    @Input('body') body: z.infer<typeof S.ReactionBodySchema>,
  ) {
    return { data: await this.updates.toggleReaction(user, 'reply', params.id, body.emoji) };
  }

  // ---------------------------------------------------------------------------- atividade ---

  @Get('items/:id/activity')
  @Endpoint({
    summary: 'Log de atividade do item (filtros: autor, coluna, período)',
    tags: ['collaboration'],
    params: IdParams,
    query: S.ActivityQuerySchema,
  })
  listActivity(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('query') query: z.infer<typeof S.ActivityQuerySchema>,
  ) {
    return this.activity.list(user, params.id, query);
  }

  @Get('items/:id/activity/actors')
  @Endpoint({
    summary: 'Autores com atividade no item (para o filtro por usuário)',
    tags: ['collaboration'],
    params: IdParams,
  })
  async activityActors(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return { data: await this.activity.actors(user, params.id) };
  }

  // ---------------------------------------------------------------------------- checklists ---

  @Get('items/:id/checklists')
  @Endpoint({ summary: 'Checklists do item', tags: ['collaboration'], params: IdParams })
  async listChecklists(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return { data: await this.checklists.list(user, params.id) };
  }

  @Post('items/:id/checklists')
  @Audited({ action: 'checklist.create', entityType: 'checklist' })
  @Endpoint({
    summary: 'Criar um checklist no item',
    tags: ['collaboration'],
    status: 201,
    params: IdParams,
    body: S.CreateChecklistBodySchema,
  })
  createChecklist(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.CreateChecklistBodySchema>,
  ) {
    return this.checklists.createChecklist(user, params.id, body.title);
  }

  @Patch('checklists/:id')
  @Audited({ action: 'checklist.rename', entityType: 'checklist' })
  @Endpoint({
    summary: 'Renomear um checklist',
    tags: ['collaboration'],
    status: 204,
    params: IdParams,
    body: S.RenameChecklistBodySchema,
  })
  async renameChecklist(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.RenameChecklistBodySchema>,
  ) {
    await this.checklists.renameChecklist(user, params.id, body.title);
  }

  @Delete('checklists/:id')
  @Audited({ action: 'checklist.delete', entityType: 'checklist' })
  @Endpoint({ summary: 'Excluir um checklist', tags: ['collaboration'], status: 204, params: IdParams })
  async deleteChecklist(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.checklists.deleteChecklist(user, params.id);
  }

  @Post('checklists/:id/items')
  @Audited({ action: 'checklist_item.create', entityType: 'checklist_item' })
  @Endpoint({
    summary: 'Adicionar item ao checklist',
    tags: ['collaboration'],
    status: 201,
    params: IdParams,
    body: S.AddChecklistItemBodySchema,
  })
  addChecklistItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.AddChecklistItemBodySchema>,
  ) {
    return this.checklists.addItem(user, params.id, body);
  }

  @Patch('checklist-items/:id')
  @Audited({ action: 'checklist_item.update', entityType: 'checklist_item' })
  @Endpoint({
    summary: 'Atualizar (ou marcar) um item do checklist',
    tags: ['collaboration'],
    status: 204,
    params: IdParams,
    body: S.UpdateChecklistItemBodySchema,
  })
  async updateChecklistItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateChecklistItemBodySchema>,
  ) {
    await this.checklists.updateItem(user, params.id, body);
  }

  @Delete('checklist-items/:id')
  @Audited({ action: 'checklist_item.delete', entityType: 'checklist_item' })
  @Endpoint({
    summary: 'Excluir um item do checklist',
    tags: ['collaboration'],
    status: 204,
    params: IdParams,
  })
  async deleteChecklistItem(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.checklists.deleteItem(user, params.id);
  }

  // Dependências (predecessora/sucessora) já têm API própria desde o Prompt 5 (coluna de
  // dependência, com detecção de ciclo no grafo do board inteiro): `GET boards/:id/dependencies` e
  // `PUT items/:id/dependencies` em `work/presentation/board-content.controller.ts`. O painel do
  // item reaproveita `DependencyEditor` (`apps/web/src/features/table/dependency-editor.tsx`).

  // -------------------------------------------------------------------------------- seguir ---

  @Get('items/:id/follow')
  @Endpoint({ summary: 'Status de seguir e lista de seguidores', tags: ['collaboration'], params: IdParams })
  followStatus(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return this.follows.status(user, params.id);
  }

  @Post('items/:id/follow')
  @Audited({ action: 'follow.set', entityType: 'item' })
  @Endpoint({
    summary: 'Seguir ou deixar de seguir o item',
    tags: ['collaboration'],
    status: 204,
    params: IdParams,
    body: S.FollowBodySchema,
  })
  async setFollow(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.FollowBodySchema>,
  ) {
    await this.follows.setFollowing(user, params.id, body.following);
  }

  // ----------------------------------------------------------------------------- aprovações ---

  @Get('items/:id/approvals')
  @Endpoint({ summary: 'Pedidos de aprovação do item', tags: ['collaboration'], params: IdParams })
  async listApprovals(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return { data: await this.approvals.list(user, params.id) };
  }

  @Post('items/:id/approvals')
  @Audited({ action: 'approval.request', entityType: 'approval_request' })
  @Endpoint({
    summary: 'Solicitar aprovação a um ou mais aprovadores',
    tags: ['collaboration'],
    status: 201,
    params: IdParams,
    body: S.RequestApprovalBodySchema,
  })
  requestApproval(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.RequestApprovalBodySchema>,
  ) {
    return this.approvals.request(user, params.id, body);
  }

  @Post('approvals/:id/decide')
  @Audited({ action: 'approval.decide', entityType: 'approval_request' })
  @Endpoint({
    summary: 'Aprovar ou rejeitar um pedido (só o aprovador designado)',
    tags: ['collaboration'],
    status: 200,
    params: IdParams,
    body: S.DecideApprovalBodySchema,
  })
  decideApproval(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.DecideApprovalBodySchema>,
  ) {
    return this.approvals.decide(user, params.id, body.decision, body.comment);
  }

  @Post('approvals/:id/cancel')
  @Audited({ action: 'approval.cancel', entityType: 'approval_request' })
  @Endpoint({
    summary: 'Cancelar um pedido de aprovação pendente',
    tags: ['collaboration'],
    status: 204,
    params: IdParams,
  })
  async cancelApproval(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.approvals.cancel(user, params.id);
  }
}
