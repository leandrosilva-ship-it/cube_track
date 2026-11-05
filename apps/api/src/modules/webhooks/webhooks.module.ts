import { Module } from '@nestjs/common';

import { WebhookDeliveriesService } from './application/webhook-deliveries.service.js';
import { WebhooksService } from './application/webhooks.service.js';
import { WebhookDeliveriesController } from './presentation/webhook-deliveries.controller.js';
import { WebhooksController } from './presentation/webhooks.controller.js';

/** Webhooks de saída de board/workspace (ADR 0051) e log de entregas + reenvio manual (ADR 0056). */
@Module({
  controllers: [WebhooksController, WebhookDeliveriesController],
  providers: [WebhooksService, WebhookDeliveriesService],
})
export class WebhooksModule {}
