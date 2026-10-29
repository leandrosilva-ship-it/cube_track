import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import type { Request, Response } from 'express';

import { loadConfig } from './core/config/config.js';
import { CoreModule } from './core/core.module.js';
import { LoggingModule } from './core/logging/logging.module.js';
import { HealthController } from './core/observability/health.controller.js';
import { AccessModule } from './modules/access/access.module.js';
import { AutomationsModule } from './modules/automations/automations.module.js';
import { CollaborationModule } from './modules/collaboration/collaboration.module.js';
import { DashboardsModule } from './modules/dashboards/dashboards.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { FormsModule } from './modules/forms/forms.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PlanningModule } from './modules/planning/planning.module.js';
import { ProcessesModule } from './modules/processes/processes.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { PortfolioModule } from './modules/portfolio/portfolio.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { ResourcesModule } from './modules/resources/resources.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { StructureModule } from './modules/structure/structure.module.js';
import { TimesheetModule } from './modules/timesheet/timesheet.module.js';
import { WorkModule } from './modules/work/work.module.js';

@Module({
  imports: [
    LoggingModule,
    CoreModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      path: '/v1/graphql',
      autoSchemaFile: true,
      sortSchema: true,
      playground: false,
      introspection: true,
      context: ({ req, res }: { req: Request; res: Response }) => ({ req, res }),
    }),
    AccessModule,
    IdentityModule,
    WorkModule,
    StructureModule,
    FilesModule,
    CollaborationModule,
    PlanningModule,
    FormsModule,
    DashboardsModule,
    AutomationsModule,
    ProcessesModule,
    WebhooksModule,
    ResourcesModule,
    TimesheetModule,
    PortfolioModule,
    SearchModule,
    // Com REALTIME_MODE=separate o gateway roda só no processo main.realtime (ADR 0027).
    ...(loadConfig().REALTIME_MODE === 'embedded' ? [RealtimeModule] : []),
  ],
  controllers: [HealthController],
})
export class AppModule {}
