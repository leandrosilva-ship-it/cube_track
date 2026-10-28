import { Module } from '@nestjs/common';

import { TimeEntriesService } from './application/time-entries.service.js';
import { TimesheetApprovalsService } from './application/timesheet-approvals.service.js';
import { TimesheetController } from './presentation/timesheet.controller.js';

/** Apontamento de horas e aprovação de timesheet (ADR 0052). */
@Module({
  controllers: [TimesheetController],
  providers: [TimeEntriesService, TimesheetApprovalsService],
})
export class TimesheetModule {}
