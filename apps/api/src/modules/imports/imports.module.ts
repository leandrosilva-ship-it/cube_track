import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { ImportsService } from './application/imports.service.js';
import { BoardImportsController, ImportsController } from './presentation/imports.controller.js';

/** Importação em background (Monday/Trello/Jira/Pipefy/CSV, ADR 0056) — commit roda na fila `imports`. */
@Module({
  imports: [WorkServicesModule],
  controllers: [BoardImportsController, ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
