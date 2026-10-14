import { Module } from '@nestjs/common';

import { CoreModule } from '../../core/core.module.js';
import { LoggingModule } from '../../core/logging/logging.module.js';
import { HealthController } from '../../core/observability/health.controller.js';
import { AccessModule } from '../access/access.module.js';
import { RealtimeModule } from './realtime.module.js';

/** Aplicação do processo realtime dedicado: apenas gateway, health e dependências. */
@Module({
  imports: [LoggingModule, CoreModule, AccessModule, RealtimeModule],
  controllers: [HealthController],
})
export class RealtimeAppModule {}
