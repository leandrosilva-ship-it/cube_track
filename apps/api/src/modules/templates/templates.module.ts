import { Module } from '@nestjs/common';

import { AutomationsModule } from '../automations/automations.module.js';
import { DashboardsModule } from '../dashboards/dashboards.module.js';
import { FormsModule } from '../forms/forms.module.js';
import { StructureModule } from '../structure/structure.module.js';
import { WorkServicesModule } from '../work/work.module.js';
import { TemplatesService } from './application/templates.service.js';
import { SaveBoardAsTemplateController, TemplatesController } from './presentation/templates.controller.js';

/**
 * Galeria de templates — global (plataforma) e do tenant (ADR 0056). Aplicar um template reaproveita
 * os caminhos de criação de cada módulo (board, automação, dashboard, formulário), por isso importa
 * os serviços deles em vez de duplicar lógica de criação.
 */
@Module({
  imports: [WorkServicesModule, StructureModule, AutomationsModule, DashboardsModule, FormsModule],
  controllers: [TemplatesController, SaveBoardAsTemplateController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
