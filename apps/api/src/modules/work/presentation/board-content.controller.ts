import { Controller, Delete, Get, Patch, Post, Put, StreamableFile } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { ColumnsService } from '../application/columns.service.js';
import { GroupsService } from '../application/groups.service.js';
import { ImportExportService } from '../application/import-export.service.js';
import { ItemsService } from '../application/items.service.js';
import * as S from './schemas.js';

/** Colunas, grupos, ações em massa, lixeira, importação/exportação e extras de itens (Prompt 5). */
@Controller()
export class BoardContentController {
  constructor(
    private readonly columns: ColumnsService,
    private readonly groups: GroupsService,
    private readonly items: ItemsService,
    private readonly transfer: ImportExportService,
  ) {}

  // ------------------------------------------------------------------------------- colunas ---

  @Post('boards/:boardId/columns')
  @Audited({ action: 'column.create', entityType: 'column' })
  @Endpoint({
    summary: 'Criar coluna',
    description:
      'A chave (`c_<título>`) é gerada pelo servidor. Fórmulas aceitam `{Título}` e são normalizadas para `{c_chave}`.',
    tags: ['columns'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateColumnBody,
    response: S.ColumnRefResponse,
    errors: [422],
  })
  createColumn(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateColumnBody>,
  ) {
    return this.columns.create(user, params.boardId, body);
  }

  @Patch('boards/:boardId/columns/:columnId')
  @Audited({ action: 'column.update', entityType: 'column' })
  @Endpoint({
    summary: 'Atualizar coluna (título, configurações, regras, valor padrão, permissões, posição)',
    tags: ['columns'],
    params: S.ColumnParams,
    body: S.UpdateColumnBody,
    errors: [422],
  })
  updateColumn(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ColumnParams>,
    @Input('body') body: z.infer<typeof S.UpdateColumnBody>,
  ) {
    return this.columns.update(user, params.boardId, params.columnId, body);
  }

  @Delete('boards/:boardId/columns/:columnId')
  @Audited({ action: 'column.delete', entityType: 'column' })
  @Endpoint({ summary: 'Excluir coluna', tags: ['columns'], status: 204, params: S.ColumnParams })
  async deleteColumn(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ColumnParams>,
  ) {
    await this.columns.remove(user, params.boardId, params.columnId);
  }

  @Post('boards/:boardId/columns/:columnId/duplicate')
  @Audited({ action: 'column.duplicate', entityType: 'column' })
  @Endpoint({
    summary: 'Duplicar coluna (com ou sem valores)',
    tags: ['columns'],
    status: 201,
    params: S.ColumnParams,
    body: S.DuplicateColumnBody,
    response: S.ColumnRefResponse,
  })
  duplicateColumn(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ColumnParams>,
    @Input('body') body: z.infer<typeof S.DuplicateColumnBody>,
  ) {
    return this.columns.duplicate(user, params.boardId, params.columnId, body.includeValues);
  }

  @Put('boards/:boardId/columns/:columnId/labels')
  @Audited({ action: 'column.labels', entityType: 'column' })
  @Endpoint({
    summary: 'Substituir rótulos de uma coluna de status',
    description:
      'Rótulos sem `id` são criados; os ausentes são removidos e os itens que os usavam ficam vazios.',
    tags: ['columns'],
    params: S.ColumnParams,
    body: S.ReplaceLabelsBody,
    response: S.ColumnRefResponse,
  })
  replaceLabels(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ColumnParams>,
    @Input('body') body: z.infer<typeof S.ReplaceLabelsBody>,
  ) {
    return this.columns.replaceLabels(user, params.boardId, params.columnId, body.labels);
  }

  @Put('boards/:boardId/columns/:columnId/options')
  @Audited({ action: 'column.options', entityType: 'column' })
  @Endpoint({
    summary: 'Substituir opções de uma coluna de lista',
    tags: ['columns'],
    params: S.ColumnParams,
    body: S.ReplaceOptionsBody,
    response: S.ColumnRefResponse,
  })
  replaceOptions(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ColumnParams>,
    @Input('body') body: z.infer<typeof S.ReplaceOptionsBody>,
  ) {
    return this.columns.replaceOptions(user, params.boardId, params.columnId, body.options);
  }

  @Put('boards/:boardId/status-column')
  @Audited({ action: 'board.status_column', entityType: 'board' })
  @Endpoint({
    summary: 'Definir a coluna de status principal (conclusão e "atrasados")',
    tags: ['columns'],
    status: 204,
    params: S.BoardParams,
    body: S.StatusColumnBody,
  })
  async statusColumn(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.StatusColumnBody>,
  ) {
    await this.columns.setStatusColumn(user, params.boardId, body.statusColumnKey);
  }

  // -------------------------------------------------------------------------------- grupos ---

  @Post('boards/:boardId/groups')
  @Audited({ action: 'group.create', entityType: 'group' })
  @Endpoint({
    summary: 'Criar grupo',
    tags: ['groups'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateGroupBody,
    response: S.GroupSchema,
  })
  createGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateGroupBody>,
  ) {
    return this.groups.create(user, params.boardId, body);
  }

  @Patch('groups/:groupId')
  @Audited({ action: 'group.update', entityType: 'group' })
  @Endpoint({
    summary: 'Atualizar grupo (nome, cor, posição, recolhido, arquivado)',
    tags: ['groups'],
    params: S.GroupParams,
    body: S.UpdateGroupBody,
    response: S.GroupSchema,
  })
  updateGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.GroupParams>,
    @Input('body') body: z.infer<typeof S.UpdateGroupBody>,
  ) {
    return this.groups.update(user, params.groupId, body);
  }

  @Delete('groups/:groupId')
  @Audited({ action: 'group.delete', entityType: 'group' })
  @Endpoint({
    summary: 'Excluir grupo e itens (lixeira)',
    tags: ['groups'],
    status: 204,
    params: S.GroupParams,
  })
  async deleteGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.GroupParams>,
  ) {
    await this.groups.remove(user, params.groupId);
  }

  @Post('groups/:groupId/restore')
  @Audited({ action: 'group.restore', entityType: 'group' })
  @Endpoint({
    summary: 'Restaurar grupo da lixeira (com seus itens)',
    status: 200,
    tags: ['groups'],
    params: S.GroupParams,
    response: S.GroupSchema,
  })
  restoreGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.GroupParams>,
  ) {
    return this.groups.restore(user, params.groupId);
  }

  @Post('groups/:groupId/duplicate')
  @Audited({ action: 'group.duplicate', entityType: 'group' })
  @Endpoint({
    summary: 'Duplicar grupo (com ou sem itens)',
    tags: ['groups'],
    status: 201,
    params: S.GroupParams,
    body: S.DuplicateGroupBody,
    response: S.GroupSchema,
  })
  duplicateGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.GroupParams>,
    @Input('body') body: z.infer<typeof S.DuplicateGroupBody>,
  ) {
    return this.groups.duplicate(user, params.groupId, body.includeItems);
  }

  @Post('groups/:groupId/move')
  @Audited({ action: 'group.move', entityType: 'group' })
  @Endpoint({
    summary: 'Mover grupo para outro board (com mapeamento de colunas)',
    status: 200,
    tags: ['groups'],
    params: S.GroupParams,
    body: S.MoveGroupBody,
    response: S.GroupSchema,
  })
  moveGroup(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.GroupParams>,
    @Input('body') body: z.infer<typeof S.MoveGroupBody>,
  ) {
    return this.groups.move(user, params.groupId, body);
  }

  // ---------------------------------------------------------------------------- itens (massa) ---

  @Patch('boards/:boardId/items')
  @Audited({ action: 'item.bulk_update', entityType: 'item' })
  @Endpoint({
    summary: 'Editar vários itens (colar células, preencher abaixo, edição em massa)',
    description: 'Tudo ou nada: um erro desfaz o lote. Máximo de 500 itens.',
    tags: ['items'],
    params: S.BoardParams,
    body: S.BulkUpdateBody,
    response: S.ItemListResponse,
    errors: [409, 422],
  })
  async bulkUpdate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.BulkUpdateBody>,
  ) {
    return { data: await this.items.updateMany(user, params.boardId, body.items) };
  }

  @Post('boards/:boardId/items/actions')
  @Audited({ action: 'item.action', entityType: 'item' })
  @Endpoint({
    summary: 'Ações em itens: duplicar, arquivar, desarquivar, excluir, restaurar, mover',
    status: 200,
    description:
      'Mover para outro board exige `columnMapping` (origem → destino; null descarta). Subitens acompanham o item.',
    tags: ['items'],
    params: S.BoardParams,
    body: S.ItemActionBody,
    response: S.ItemActionResponse,
    errors: [422],
  })
  actions(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.ItemActionBody>,
  ) {
    return this.items.runAction(user, params.boardId, body);
  }

  @Get('boards/:boardId/trash')
  @Endpoint({
    summary: 'Lixeira do board (itens e grupos excluídos nos últimos 30 dias)',
    tags: ['items'],
    params: S.BoardParams,
    response: S.TrashResponse,
  })
  trash(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return this.items.trash(user, params.boardId);
  }

  @Post('items/:id/seen')
  @Audited({ action: 'item.seen', entityType: 'item' })
  @Endpoint({
    summary: 'Marcar atualizações do item como vistas',
    tags: ['items'],
    status: 204,
    params: IdParams,
  })
  async seen(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: { id: string }) {
    await this.items.markSeen(user, params.id);
  }

  @Post('items/:id/timer/:columnKey')
  @Audited({ action: 'item.timer', entityType: 'item' })
  @Endpoint({
    summary: 'Iniciar ou parar o cronômetro de uma coluna de tempo rastreado',
    status: 200,
    tags: ['items'],
    params: S.TimerParams,
    body: S.TimerBody,
    response: S.ItemSchema,
  })
  timer(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.TimerParams>,
    @Input('body') body: z.infer<typeof S.TimerBody>,
  ) {
    return this.items.timer(user, params.id, params.columnKey, body.action);
  }

  @Post('items/:id/buttons/:columnKey')
  @Audited({ action: 'item.button_clicked', entityType: 'item' })
  @Endpoint({
    summary: 'Clicar no botão de uma coluna `button`',
    description:
      'Requer `item.update`. Dispara (de forma assíncrona) a automação configurada na coluna ' +
      '(ADR 0051); responde 204 assim que o evento é registrado, sem esperar a execução.',
    status: 204,
    tags: ['items'],
    params: S.TimerParams,
    errors: [422],
  })
  async clickButton(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.TimerParams>,
  ) {
    await this.items.clickButton(user, params.id, params.columnKey);
  }

  @Get('boards/:boardId/dependencies')
  @Endpoint({
    summary: 'Dependências entre itens do board',
    tags: ['items'],
    params: S.BoardParams,
    response: S.DependenciesResponse,
  })
  dependencies(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return this.items.dependencies(user, params.boardId);
  }

  @Put('items/:id/dependencies')
  @Audited({ action: 'item.dependencies', entityType: 'item' })
  @Endpoint({
    summary: 'Substituir predecessores do item (recusa ciclos)',
    tags: ['items'],
    status: 204,
    params: IdParams,
    body: S.SetDependenciesBody,
    errors: [422],
  })
  async setDependencies(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: { id: string },
    @Input('body') body: z.infer<typeof S.SetDependenciesBody>,
  ) {
    await this.items.setDependencies(user, params.id, body.predecessors);
  }

  // ---------------------------------------------------------------- importação / exportação ---

  @Post('boards/:boardId/imports')
  @Audited({ action: 'board.import_preview', entityType: 'board' })
  @Endpoint({
    summary: 'Enviar planilha (CSV ou XLSX em base64) e obter a prévia com mapeamento sugerido',
    description: 'Até 10 MB e 5.000 linhas. A prévia fica disponível por 30 minutos.',
    tags: ['import-export'],
    status: 201,
    params: S.BoardParams,
    body: S.ImportUploadBody,
    response: S.ImportPreviewResponse,
    errors: [413, 422],
  })
  importPreview(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.ImportUploadBody>,
  ) {
    return this.transfer.preview(user, params.boardId, body);
  }

  @Post('boards/:boardId/imports/:importId/commit')
  @Audited({ action: 'board.import', entityType: 'board' })
  @Endpoint({
    summary: 'Importar as linhas com o mapeamento escolhido',
    status: 200,
    description:
      'Linhas com valores inválidos são ignoradas e relatadas (até 200 erros). `createMissing` cria grupos, rótulos e opções citados.',
    tags: ['import-export'],
    params: S.ImportParams,
    body: S.ImportCommitBody,
    response: S.ImportResultResponse,
  })
  importCommit(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ImportParams>,
    @Input('body') body: z.infer<typeof S.ImportCommitBody>,
  ) {
    return this.transfer.commit(user, params.boardId, params.importId, body);
  }

  @Get('boards/:boardId/export')
  @Endpoint({
    summary: 'Exportar itens visíveis (CSV ou Excel), com filtros e ordenação',
    tags: ['import-export'],
    params: S.BoardParams,
    query: S.ExportQuery,
  })
  async export(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('query') query: z.infer<typeof S.ExportQuery>,
  ) {
    const file = await this.transfer.export(user, params.boardId, {
      format: query.format,
      locale: query.locale,
      filter: query.filter ?? null,
      sort: query.sort ?? [],
      search: query.search,
    });
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.body.byteLength,
    });
  }
}
