import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { BoardsService } from '../application/boards.service.js';
import { ItemsService } from '../application/items.service.js';
import * as S from './schemas.js';

@Controller()
export class WorkController {
  constructor(
    private readonly boards: BoardsService,
    private readonly items: ItemsService,
  ) {}

  @Get('workspaces')
  @Endpoint({
    summary: 'Listar workspaces acessíveis',
    tags: ['workspaces'],
    response: z.object({ data: z.array(S.WorkspaceSchema) }),
  })
  async workspaces(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.boards.listWorkspaces(user) };
  }

  @Get('workspaces/:workspaceId/boards')
  @Endpoint({
    summary: 'Listar boards acessíveis do workspace',
    tags: ['boards'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.BoardSummarySchema) }),
  })
  async boardsOf(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
  ) {
    return { data: await this.boards.listBoards(user, params.workspaceId) };
  }

  @Get('boards/:boardId')
  @Endpoint({
    summary: 'Board com grupos e colunas visíveis',
    description:
      'Colunas sem permissão de leitura não são retornadas; `canEdit` indica permissão de edição.',
    tags: ['boards'],
    params: S.BoardParams,
    response: S.BoardDetailSchema,
  })
  board(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return this.boards.getBoard(user, params.boardId);
  }

  @Patch('boards/:boardId/columns/:columnId')
  @Audited({ action: 'column.update', entityType: 'column' })
  @Endpoint({
    summary: 'Atualizar coluna (título, largura, obrigatoriedade, permissões)',
    tags: ['boards'],
    params: S.ColumnParams,
    body: S.UpdateColumnBody,
  })
  updateColumn(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ColumnParams>,
    @Input('body') body: z.infer<typeof S.UpdateColumnBody>,
  ) {
    return this.boards.updateColumn(user, params.boardId, params.columnId, body);
  }

  @Get('boards/:boardId/events')
  @Endpoint({
    summary: 'Replay de eventos do board após uma sequência (reconexão)',
    tags: ['realtime'],
    params: S.BoardParams,
    query: S.EventsQuery,
    response: S.EventsResponse,
  })
  events(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('query') query: z.infer<typeof S.EventsQuery>,
  ) {
    return this.boards.replay(user, params.boardId, query.after);
  }

  @Get('boards/:boardId/items')
  @Endpoint({
    summary: 'Listar itens (paginação por cursor, filtros e ordenação)',
    description:
      '`filter` é a AST JSON (`{"op":"and","conditions":[{"field":"c_status","operator":"any_of","value":["…"]}]}`); `sort=c_ust:desc,name:asc`. Valores de colunas sem permissão são omitidos; filtrar/ordenar por elas retorna 403.',
    tags: ['items'],
    params: S.BoardParams,
    query: S.ListItemsQuery,
    response: S.ItemPageSchema,
  })
  list(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('query') query: z.infer<typeof S.ListItemsQuery>,
  ) {
    return this.items.list(user, params.boardId, {
      filter: query.filter ?? null,
      sort: query.sort ?? [],
      limit: query.limit,
      cursor: query.cursor,
      groupId: query.groupId,
      parentItemId: query.parentItemId ?? null,
      includeArchived: query.includeArchived ?? false,
    });
  }

  @Post('boards/:boardId/items')
  @Audited({ action: 'item.create', entityType: 'item' })
  @Endpoint({
    summary: 'Criar item',
    tags: ['items'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateItemBody,
    response: S.ItemSchema,
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateItemBody>,
  ) {
    return this.items.create(user, params.boardId, body);
  }

  @Get('items/:id')
  @Endpoint({ summary: 'Obter item', tags: ['items'], params: IdParams, response: S.ItemSchema })
  get(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: { id: string }) {
    return this.items.get(user, params.id);
  }

  @Patch('items/:id')
  @Audited({ action: 'item.update', entityType: 'item' })
  @Endpoint({
    summary: 'Atualizar item (valores, campos nativos, grupo, posição)',
    description:
      'LWW por campo; envie `baseVersions` para atualização condicional (409 em conflito). `values.<coluna>: null` limpa o valor.',
    tags: ['items'],
    params: IdParams,
    body: S.UpdateItemBody,
    response: S.ItemSchema,
    errors: [409],
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: { id: string },
    @Input('body') body: z.infer<typeof S.UpdateItemBody>,
  ) {
    return this.items.update(user, params.id, body);
  }

  @Delete('items/:id')
  @Audited({ action: 'item.delete', entityType: 'item' })
  @Endpoint({ summary: 'Excluir item (lixeira)', tags: ['items'], status: 204, params: IdParams })
  async remove(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: { id: string }) {
    await this.items.remove(user, params.id);
  }
}
