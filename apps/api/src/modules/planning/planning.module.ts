import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { BaselinesService } from './application/baselines.service.js';
import { GanttService } from './application/gantt.service.js';
import { MilestonesService } from './application/milestones.service.js';
import { ScheduleImportService } from './application/schedule-import.service.js';
import { PlanningController } from './presentation/planning.controller.js';

/**
 * Calendário, Timeline, Gantt/Cronograma e marcos/baselines do board (Prompt 8, ADR 0049).
 */
@Module({
  imports: [WorkServicesModule],
  controllers: [PlanningController],
  providers: [GanttService, MilestonesService, BaselinesService, ScheduleImportService],
})
export class PlanningModule {}
