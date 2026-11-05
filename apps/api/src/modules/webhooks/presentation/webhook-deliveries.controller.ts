import { Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { WebhookDeliveriesService } from '../application/webhook-deliveries.service.js';
import * as S from './schemas.js';

const DeliveryQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Log de entregas de um webhook e reenvio manual (ADR 0051/0056). Requer `webhook.manage` no board. */
@Controller()
export class WebhookDeliveriesController {
  constructor(private readonly deliveries: WebhookDeliveriesService) {}

  @Get('webhooks/:id/deliveries')
  @Endpoint({
    summary: 'Listar as entregas de um webhook (mais recentes primeiro)',
    description: 'Requer `webhook.manage` no board (ou `workspace.manage` para webhook de workspace).',
    tags: ['webhooks'],
    params: IdParams,
    query: DeliveryQuery,
    response: z.object({
      data: z.array(S.WebhookDeliverySchema),
      pageInfo: z.object({ nextCursor: z.string().nullable(), hasNextPage: z.boolean() }),
    }),
  })
  list(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
    @Input('query') query: z.infer<typeof DeliveryQuery>,
  ) {
    return this.deliveries.list(user, params.id, query);
  }

  @Post('webhook-deliveries/:id/resend')
  @Audited({ action: 'webhook_delivery.resend', entityType: 'webhook_delivery' })
  @Endpoint({
    summary: 'Reenviar agora uma entrega específica',
    description:
      'Reenfileira o mesmo evento para o mesmo webhook com um `eventId` novo — cria uma linha NOVA ' +
      'de entrega (nunca sobrescreve a original). Requer `webhook.manage` no board do webhook.',
    tags: ['webhooks'],
    status: 201,
    params: IdParams,
    response: S.WebhookDeliverySchema,
  })
  resend(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof IdParams>,
  ) {
    return this.deliveries.resend(user, params.id);
  }
}
