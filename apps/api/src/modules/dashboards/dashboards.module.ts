import { Module } from '@nestjs/common';

import { ResourcesModule } from '../resources/resources.module.js';
import { WorkServicesModule } from '../work/work.module.js';
import { DashboardsService } from './application/dashboards.service.js';
import { ProjectHealthService } from './application/project-health.service.js';
import { WidgetDataService } from './application/widget-data.service.js';
import { WidgetsService } from './application/widgets.service.js';
import { DashboardsController } from './presentation/dashboards.controller.js';

/** Dashboards, widgets, agregações e saúde do projeto (Prompt 9, ADR 0050; widget de capacidade ADR 0052). */
@Module({
  imports: [WorkServicesModule, ResourcesModule],
  controllers: [DashboardsController],
  providers: [DashboardsService, WidgetsService, WidgetDataService, ProjectHealthService],
})
export class DashboardsModule {}
