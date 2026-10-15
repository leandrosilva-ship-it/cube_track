import { Controller, Delete, Get, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { WorkspaceSchema } from '../../work/presentation/schemas.js';
import { InboxService } from '../application/inbox.service.js';
import { StructureService } from '../application/structure.service.js';
import * as S from './schemas.js';

type Id = z.infer<typeof IdParams>;

@Controller()
export class StructureController {
  constructor(
    private readonly structure: StructureService,
    private readonly inbox: InboxService,
  ) {}

  @Post('workspaces')
  @Audited({ action: 'workspace.create', entityType: 'workspace' })
  @Endpoint({
    summary: 'Criar workspace (o criador vira administrador)',
    tags: ['workspaces'],
    status: 201,
    body: S.CreateWorkspaceBody,
    response: WorkspaceSchema,
  })
  createWorkspace(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.CreateWorkspaceBody>,
  ) {
    return this.structure.createWorkspace(user, body);
  }

  @Get('workspaces/:workspaceId/tree')
  @Endpoint({
    summary: 'Árvore de pastas e boards do workspace (filtrada por permissão)',
    tags: ['workspaces'],
    params: S.WorkspaceParams,
    response: S.TreeSchema,
  })
  tree(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
  ) {
    return this.structure.tree(user, params.workspaceId);
  }

  @Post('workspaces/:workspaceId/folders')
  @Audited({ action: 'folder.create', entityType: 'folder' })
  @Endpoint({
    summary: 'Criar pasta',
    tags: ['workspaces'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateFolderBody,
    response: S.FolderSchema.extend({ workspaceId: z.uuid() }),
  })
  createFolder(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateFolderBody>,
  ) {
    return this.structure.createFolder(user, params.workspaceId, body);
  }

  @Patch('folders/:id')
  @Audited({ action: 'folder.update', entityType: 'folder' })
  @Endpoint({
    summary: 'Renomear, colorir ou mover pasta (pai e posição entre vizinhos)',
    tags: ['workspaces'],
    params: IdParams,
    body: S.UpdateFolderBody,
    response: S.ChangesResponse,
  })
  updateFolder(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: Id,
    @Input('body') body: z.infer<typeof S.UpdateFolderBody>,
  ) {
    return this.structure.updateFolder(user, params.id, body);
  }

  @Delete('folders/:id')
  @Audited({ action: 'folder.delete', entityType: 'folder' })
  @Endpoint({
    summary: 'Excluir pasta (subpastas e boards sobem um nível)',
    tags: ['workspaces'],
    status: 204,
    params: IdParams,
  })
  async deleteFolder(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: Id) {
    await this.structure.deleteFolder(user, params.id);
  }

  @Get('board-templates')
  @Endpoint({
    summary: 'Templates de board (embutidos e boards marcados como template)',
    tags: ['boards'],
    response: S.BoardTemplatesResponse,
  })
  templates(@CurrentPrincipal() user: AuthPrincipal) {
    return this.structure.templates(user);
  }

  @Post('workspaces/:workspaceId/boards')
  @Audited({ action: 'board.create', entityType: 'board' })
  @Endpoint({
    summary: 'Criar board do zero ou de template (embutido ou board-template)',
    tags: ['boards'],
    status: 201,
    params: S.WorkspaceParams,
    body: S.CreateBoardBody,
    response: S.TreeBoardSchema.omit({ description: true, position: true }),
  })
  createBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
    @Input('body') body: z.infer<typeof S.CreateBoardBody>,
  ) {
    return this.structure.createBoard(user, params.workspaceId, body);
  }

  @Patch('boards/:boardId')
  @Audited({ action: 'board.update', entityType: 'board' })
  @Endpoint({
    summary: 'Renomear, descrever ou mover board (pasta e posição)',
    tags: ['boards'],
    params: S.BoardParams,
    body: S.UpdateBoardBody,
    response: S.ChangesResponse,
  })
  updateBoard(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.UpdateBoardBody>,
  ) {
    return this.structure.updateBoard(user, params.boardId, body);
  }

  @Get('me/favorites')
  @Endpoint({
    summary: 'Favoritos do usuário',
    tags: ['me'],
    response: z.object({ data: z.array(S.FavoriteSchema) }),
  })
  async favorites(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.structure.favorites(user) };
  }

  @Put('me/favorites')
  @Audited({ action: 'favorite.add', entityType: 'favorite' })
  @Endpoint({
    summary: 'Adicionar favorito (idempotente)',
    tags: ['me'],
    body: S.AddFavoriteBody,
    response: S.AddFavoriteBody,
  })
  addFavorite(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.AddFavoriteBody>,
  ) {
    return this.structure.addFavorite(user, body.entityType, body.entityId);
  }

  @Delete('me/favorites/:entityType/:entityId')
  @Audited({ action: 'favorite.remove', entityType: 'favorite' })
  @Endpoint({ summary: 'Remover favorito', tags: ['me'], status: 204, params: S.FavoriteParams })
  async removeFavorite(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.FavoriteParams>,
  ) {
    await this.structure.removeFavorite(user, params.entityType, params.entityId);
  }

  @Get('boards/:boardId/views')
  @Endpoint({
    summary: 'Views do board visíveis ao usuário',
    tags: ['views'],
    params: S.BoardParams,
    response: z.object({ canManage: z.boolean(), data: z.array(S.ViewSchema) }),
  })
  views(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return this.structure.listViews(user, params.boardId);
  }

  @Post('boards/:boardId/views')
  @Audited({ action: 'view.create', entityType: 'view' })
  @Endpoint({
    summary: 'Criar view (compartilhada exige view.manage; pessoal exige leitura)',
    tags: ['views'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateViewBody,
    response: S.ViewSchema,
  })
  createView(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateViewBody>,
  ) {
    return this.structure.createView(user, params.boardId, body);
  }

  @Patch('views/:id')
  @Audited({ action: 'view.update', entityType: 'view' })
  @Endpoint({
    summary: 'Renomear ou reordenar view',
    tags: ['views'],
    params: IdParams,
    body: S.UpdateViewBody,
    response: S.ChangesResponse,
  })
  updateView(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: Id,
    @Input('body') body: z.infer<typeof S.UpdateViewBody>,
  ) {
    return this.structure.updateView(user, params.id, body);
  }

  @Delete('views/:id')
  @Audited({ action: 'view.delete', entityType: 'view' })
  @Endpoint({
    summary: 'Excluir view (exceto a padrão)',
    tags: ['views'],
    status: 204,
    params: IdParams,
  })
  async deleteView(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: Id) {
    await this.structure.deleteView(user, params.id);
  }

  @Get('me/notifications')
  @Endpoint({
    summary: 'Caixa de entrada (notificações, paginação por cursor)',
    tags: ['me'],
    query: S.NotificationQuery,
    response: S.NotificationPage,
  })
  notifications(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.NotificationQuery>,
  ) {
    return this.inbox.notifications(user, query);
  }

  @Post('me/notifications/read')
  @Audited({ action: 'notification.read', entityType: 'notification' })
  @Endpoint({
    summary: 'Marcar notificações como lidas (sem ids = todas)',
    tags: ['me'],
    status: 200,
    body: S.MarkReadBody,
    response: z.object({ updated: z.number().int() }),
  })
  markRead(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.MarkReadBody>,
  ) {
    return this.inbox.markRead(user, body.ids);
  }

  @Get('me/week')
  @Endpoint({
    summary: 'Minha semana: itens atribuídos com prazo na semana (e atrasados)',
    tags: ['me'],
    query: S.WeekQuery,
    response: S.WeekSchema,
  })
  week(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.WeekQuery>,
  ) {
    return this.inbox.week(user, query.date ?? new Date().toISOString().slice(0, 10));
  }
}
