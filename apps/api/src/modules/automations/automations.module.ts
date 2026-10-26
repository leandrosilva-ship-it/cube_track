import { Module } from '@nestjs/common';

import { AutomationsService } from './application/automations.service.js';
import { AutomationsController } from './presentation/automations.controller.js';

/** CRUD de automações de board/workspace (ADR 0051). */
@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService],
})
export class AutomationsModule {}
