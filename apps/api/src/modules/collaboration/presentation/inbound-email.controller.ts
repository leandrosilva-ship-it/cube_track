import { Controller, Headers, Inject, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { safeEqualString } from '../../../core/crypto/secrets.js';
import { UnauthorizedError } from '../../../core/errors/problems.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { MailInboundService } from '../application/mail-inbound.service.js';
import { InboundEmailBodySchema } from './schemas.js';

const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

/**
 * Webhook de e-mail recebido (ADR 0048): o provedor de "inbound parse" (SendGrid, Mailgun,
 * Postmark…) normaliza sua carga para `{ to, text }` e chama esta rota autenticada por um segredo
 * compartilhado no cabeçalho — não há sessão de usuário, então o caso de uso resolve o remetente
 * pelo endereço de resposta (`reply+<token>@…`) e gerencia sua própria transação.
 */
@Controller('email')
export class InboundEmailController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly mailInbound: MailInboundService,
  ) {}

  @Post('inbound')
  @Audited({ action: 'email.inbound', entityType: 'update', transactional: false })
  @Endpoint({
    summary: 'Webhook de e-mail recebido: resposta por e-mail vira atualização/resposta no item',
    tags: ['public'],
    public: true,
    body: InboundEmailBodySchema,
    response: z.object({
      accepted: z.boolean(),
      kind: z.enum(['update', 'reply']).optional(),
      reason: z.string().optional(),
    }),
  })
  async inbound(
    @Headers(WEBHOOK_SECRET_HEADER) secret: string | undefined,
    @Input('body') body: z.infer<typeof InboundEmailBodySchema>,
  ) {
    if (secret === undefined || !safeEqualString(secret, this.config.INBOUND_EMAIL_WEBHOOK_SECRET)) {
      throw new UnauthorizedError('webhook_unauthorized', 'Segredo do webhook inválido.');
    }
    return this.mailInbound.ingest(body);
  }
}
