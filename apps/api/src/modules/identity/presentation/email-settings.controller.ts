import { Controller, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { EmailSettingsService } from '../application/email-settings.service.js';
import * as S from './email-settings.schemas.js';

/** Configuração de SMTP do tenant — host/porta/usuário/senha e remetente, substituindo o SMTP
 * padrão da plataforma para os e-mails dessa organização. */
@Controller('email/settings')
export class EmailSettingsController {
  constructor(private readonly settings: EmailSettingsService) {}

  @Get()
  @Endpoint({
    summary: 'Obter a configuração de SMTP da organização',
    description: 'Requer `email.manage`. Nunca devolve a senha em texto puro (ver `hasPassword`).',
    tags: ['email'],
    response: S.EmailSettingsResponse,
  })
  get(@CurrentPrincipal() user: AuthPrincipal) {
    return this.settings.get(user);
  }

  @Patch()
  @Audited({ action: 'email_settings.update', entityType: 'email_settings' })
  @Endpoint({
    summary: 'Atualizar a configuração de SMTP da organização',
    description: 'Requer `email.manage`. `password` é cifrada antes de salvar.',
    tags: ['email'],
    body: S.UpdateEmailSettingsBody,
    response: S.EmailSettingsResponse,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.UpdateEmailSettingsBody>,
  ) {
    return this.settings.update(user, body);
  }

  @Post('test')
  @Audited({ action: 'email_settings.test', entityType: 'email_settings' })
  @Endpoint({
    summary: 'Enviar um e-mail de teste para o próprio usuário',
    description:
      'Requer `email.manage`. Enfileira pelo mesmo caminho de produção (fila do worker) — confirme ' +
      'o recebimento na própria caixa de entrada.',
    tags: ['email'],
    status: 202,
    body: S.SendTestEmailBody,
    response: z.object({ status: z.literal('queued') }),
  })
  async sendTest(@CurrentPrincipal() user: AuthPrincipal) {
    await this.settings.sendTest(user);
    return { status: 'queued' as const };
  }
}
