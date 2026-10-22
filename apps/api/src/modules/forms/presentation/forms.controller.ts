import { Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { FormsService } from '../application/forms.service.js';
import { FormSubmissionService } from '../application/form-submission.service.js';
import * as S from './schemas.js';

@Controller()
export class FormsController {
  constructor(
    private readonly forms: FormsService,
    private readonly submission: FormSubmissionService,
  ) {}

  // ----------------------------------------------------------------------------- formulários ---

  @Get('boards/:boardId/forms')
  @Endpoint({
    summary: 'Listar formulários do board',
    tags: ['forms'],
    params: S.BoardParams,
    response: z.object({ data: z.array(S.FormSchema) }),
  })
  async list(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
  ) {
    return { data: await this.forms.list(user, params.boardId) };
  }

  @Post('boards/:boardId/forms')
  @Audited({ action: 'form.create', entityType: 'form' })
  @Endpoint({
    summary: 'Criar formulário',
    description: 'Requer `form.manage` no board. Campos são adicionados em seguida.',
    tags: ['forms'],
    status: 201,
    params: S.BoardParams,
    body: S.CreateFormBody,
    response: S.FormSchema,
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.CreateFormBody>,
  ) {
    return this.forms.create(user, params.boardId, body);
  }

  @Get('forms/:id')
  @Endpoint({ summary: 'Obter formulário', tags: ['forms'], params: IdParams, response: S.FormSchema })
  get(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof IdParams>) {
    return this.forms.get(user, params.id);
  }

  @Patch('forms/:id')
  @Audited({ action: 'form.update', entityType: 'form' })
  @Endpoint({
    summary: 'Atualizar formulário (nome, descrição, grupo-alvo, login, status, marca)',
    tags: ['forms'],
    params: IdParams,
    body: S.UpdateFormBody,
    response: S.FormSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpdateFormBody>,
  ) {
    return this.forms.update(user, params.id, body);
  }

  @Delete('forms/:id')
  @Audited({ action: 'form.delete', entityType: 'form' })
  @Endpoint({ summary: 'Excluir formulário', tags: ['forms'], params: IdParams, status: 204 })
  async remove(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.forms.remove(user, params.id);
  }

  @Post('forms/:id/public-link')
  @Audited({ action: 'form.public_link', entityType: 'form' })
  @Endpoint({
    summary: 'Emite ou revoga o link público do formulário',
    description: 'O token em claro só é retornado nesta resposta — guarde-o agora.',
    tags: ['forms'],
    params: IdParams,
    body: S.SetPublicBody,
    response: S.PublicLinkResponse,
  })
  setPublic(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.SetPublicBody>,
  ) {
    return this.forms.setPublic(user, params.id, body.isPublic);
  }

  @Post('forms/:id/submit')
  @Audited({ action: 'form.submit', entityType: 'form_submission' })
  @Endpoint({
    summary: 'Preencher o formulário dentro do app (autenticado, sem link público)',
    description: 'Requer `item.create` no board; valores seguem as mesmas permissões por coluna.',
    tags: ['forms'],
    status: 201,
    params: IdParams,
    body: S.SubmitInternalBody,
  })
  submitInternal(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.SubmitInternalBody>,
  ) {
    return this.submission.submitInternal(user, params.id, body.answers);
  }

  // --------------------------------------------------------------------------------- campos ---

  @Get('forms/:id/fields')
  @Endpoint({
    summary: 'Listar campos do formulário',
    tags: ['forms'],
    params: IdParams,
    response: z.object({ data: z.array(S.FormFieldSchema) }),
  })
  async fields(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return { data: await this.forms.listFields(user, params.id) };
  }

  @Post('forms/:id/fields')
  @Audited({ action: 'form.field_add', entityType: 'form_field' })
  @Endpoint({
    summary: 'Adicionar campo ao formulário',
    description:
      '`columnKey` é uma coluna real do board, ou os valores reservados `name`/`description`, ' +
      'ou omitido (resposta fica só no envio). `showWhen` reaproveita a AST de `requiredWhen`.',
    tags: ['forms'],
    status: 201,
    params: IdParams,
    body: S.UpsertFieldBody,
    response: S.FormFieldSchema,
  })
  addField(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpsertFieldBody>,
  ) {
    return this.forms.addField(user, params.id, body);
  }

  @Patch('form-fields/:id')
  @Audited({ action: 'form.field_update', entityType: 'form_field' })
  @Endpoint({
    summary: 'Atualizar campo do formulário',
    tags: ['forms'],
    params: IdParams,
    body: S.UpsertFieldBody,
    response: S.FormFieldSchema,
  })
  updateField(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('body') body: z.infer<typeof S.UpsertFieldBody>,
  ) {
    return this.forms.updateField(user, params.id, body);
  }

  @Delete('form-fields/:id')
  @Audited({ action: 'form.field_remove', entityType: 'form_field' })
  @Endpoint({ summary: 'Remover campo do formulário', tags: ['forms'], params: IdParams, status: 204 })
  async removeField(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    await this.forms.removeField(user, params.id);
  }
}
