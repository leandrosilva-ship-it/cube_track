import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { FanoutService } from './fanout.service.js';
import { PresenceService } from './presence.service.js';
import { RealtimeGateway } from './realtime.gateway.js';

@Module({
  imports: [WorkServicesModule],
  providers: [RealtimeGateway, FanoutService, PresenceService],
})
export class RealtimeModule implements OnApplicationBootstrap {
  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly fanout: FanoutService,
  ) {}

  onApplicationBootstrap(): void {
    this.fanout.attach(this.gateway.server);
  }
}
