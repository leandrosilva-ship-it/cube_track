import { Module } from '@nestjs/common';

import { WebhooksService } from './application/webhooks.service.js';
import { WebhooksController } from './presentation/webhooks.controller.js';

/** Webhooks de saída de board/workspace (ADR 0051). */
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
