import { Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { OptionalPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { FormSubmissionService } from '../application/form-submission.service.js';
import * as S from './schemas.js';

/**
 * Formulário público (ADR 0049): resolução e envio por token (sem login) ou com login (visitante
 * autenticado do mesmo tenant, sem captcha). Mesmo padrão do link público de view (ADR 0047): a
 * rota é `public`, mas aceita um Bearer opcional — presente, vira o autor do item.
 */
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly submission: FormSubmissionService) {}

  @Get(':token')
  @Endpoint({
    summary: 'Definição pública do formulário (campos, marca e, se anônimo, desafio de captcha)',
    tags: ['public'],
    public: true,
    params: S.FormTokenParams,
    response: S.PublicFormDefinitionSchema,
  })
  definition(@Input('params') params: z.infer<typeof S.FormTokenParams>) {
    return this.submission.publicDefinition(params.token);
  }

  @Post(':token/submit')
  // Rota pública: sem principal, o serviço abre sua própria transação (token ainda não resolvido
  // pelo interceptor global); com principal, o interceptor já abriu a transação normalmente.
  @Audited({ action: 'form.submit_public', entityType: 'form_submission', transactional: false })
  @Endpoint({
    summary: 'Enviar o formulário público (cria o item no board configurado)',
    description:
      'Sem login: exige `honeypot` vazio e `captcha` válido (emitido pela definição). Com login ' +
      '(formulário com `requiresLogin`), envie o Bearer token normalmente — sem captcha.',
    tags: ['public'],
    public: true,
    status: 201,
    params: S.FormTokenParams,
    body: S.SubmitPublicBody,
    response: S.SubmitResultSchema,
  })
  submit(
    @OptionalPrincipal() principal: AuthPrincipal | null,
    @Input('params') params: z.infer<typeof S.FormTokenParams>,
    @Input('body') body: z.infer<typeof S.SubmitPublicBody>,
  ) {
    return this.submission.submitPublic(params.token, principal, body);
  }
}
