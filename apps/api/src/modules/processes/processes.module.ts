import { Module } from '@nestjs/common';

import { ProcessesService } from './application/processes.service.js';
import { SlasService } from './application/slas.service.js';
import { ProcessesController } from './presentation/processes.controller.js';

/** Processos: pipe, fases, regras de transição e SLA de um board `kind: 'process'` (ADR 0051). */
@Module({
  controllers: [ProcessesController],
  providers: [ProcessesService, SlasService],
})
export class ProcessesModule {}
