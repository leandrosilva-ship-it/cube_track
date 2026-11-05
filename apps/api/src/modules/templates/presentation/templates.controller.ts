import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { TemplatesService } from '../application/templates.service.js';
import * as S from './schemas.js';

/**
 * Galeria de templates (ADR 0056): `scope=public` é a galeria global, somente leitura, de qualquer
 * usuário autenticado; `scope=internal` (padrão) é a do tenant — leitura livre para qualquer membro,
 * CRUD exige `templates.manage`.
 */
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @Endpoint({
    summary: 'Listar templates (galeria pública ou do tenant)',
    description:
      '`scope=public` lista a galeria global (`tenantId` nulo), sem permissão extra. `scope=internal` ' +
      '(padrão) lista a galeria do tenant — qualquer membro pode ler, só `templates.manage` administra.',
    tags: ['templates'],
    query: S.TemplateListQuery,
    response: z.object({ data: z.array(S.TemplateSchema) }),
  })
  async list(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.TemplateListQuery>,
  ) {
    return { data: await this.templates.list(user, query) };
  }

  @Get(':id')
  @Endpoint({
    summary: 'Ler um template (global ou do tenant)',
    tags: ['templates'],
    params: IdParams,
    response: S.TemplateSchema,
  })
  get(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    return this.templates.get(user, params.id);
  }

  @Post()
  @Audited({ action: 'template.create', entityType: 'template' })
  @Endpoint({
    summary: 'Criar um template na galeria do tenant',
    description: 'Requer `templates.manage`. `payload` é validado conforme `kind`.',
    tags: ['templates'],
    status: 201,
    body: S.CreateTemplateBody,
    response: S.TemplateSchema,
    errors: [422],
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.CreateTemplateBody>,
  ) {
    return this.templates.create(user, body);
  }

  @Patch(':id')
  @Audited({ action: 'template.update', entityType: 'template' })
  @Endpoint({
    summary: 'Atualizar um template da galeria do tenant',
    description: 'Requer `templates.manage`. Nunca edita um template global (`tenantId` nulo).',
    tags: ['templates'],
    params: IdParams,
    body: S.UpdateTemplateBody,
    response: S.TemplateSchema,
    errors: [422],
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateTemplateBody>,
  ) {
    return this.templates.update(user, params.id, body);
  }

  @Delete(':id')
  @Audited({ action: 'template.delete', entityType: 'template' })
  @Endpoint({
    summary: 'Excluir um template da galeria do tenant',
    description: 'Requer `templates.manage`. Nunca exclui um template global (`tenantId` nulo).',
    tags: ['templates'],
    status: 204,
    params: IdParams,
  })
  async remove(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.templates.remove(user, params.id);
  }

  @Post(':id/apply')
  @Audited({ action: 'template.apply', entityType: 'template' })
  @Endpoint({
    summary: 'Aplicar um template (criar board/workspace/automação/dashboard/formulário a partir dele)',
    description:
      'O corpo varia por `kind` do template: `board` → `{workspaceId, name?, folderId?}`; ' +
      '`workspace` → `{workspaceId}` OU `{newWorkspaceName}`; `automation` → `{boardId}`; ' +
      '`dashboard` → `{workspaceId, name?, sourceBoardIds?}`; `form` → `{boardId, targetGroupId?}`. ' +
      'A permissão de cada recurso-alvo é verificada pelo caminho de criação normal desse módulo.',
    tags: ['templates'],
    status: 201,
    params: IdParams,
    body: S.ApplyTemplateBody,
    response: S.ApplyTemplateResponse,
  })
  apply(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.ApplyTemplateBody>,
  ) {
    return this.templates.apply(user, params.id, body);
  }

}

/** `/v1/boards/:boardId/save-as-template` — fora do prefixo `templates` de propósito (o recurso
 * manipulado é o board, mesma convenção de `boards/:id/webhooks`, `boards/:id/import/preview` etc.). */
@Controller('boards')
export class SaveBoardAsTemplateController {
  constructor(private readonly templates: TemplatesService) {}

  @Post(':boardId/save-as-template')
  @Audited({ action: 'template.create', entityType: 'template' })
  @Endpoint({
    summary: 'Salvar o board atual como um novo template do tenant',
    description:
      'Requer `board.manage`. Tira uma fotografia dos grupos/colunas atuais (e dos itens, se ' +
      '`includeItems`) — mudanças futuras no board nunca afetam o template salvo.',
    tags: ['templates'],
    status: 201,
    params: S.BoardIdParams,
    body: S.SaveBoardAsTemplateBody,
    response: S.TemplateSchema,
  })
  saveAsTemplate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardIdParams>,
    @Input('body') body: z.infer<typeof S.SaveBoardAsTemplateBody>,
  ) {
    return this.templates.saveBoardAsTemplate(user, params.boardId, body);
  }
}
