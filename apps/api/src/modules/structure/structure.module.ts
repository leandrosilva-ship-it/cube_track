import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { BoardBlueprintWriter } from './application/board-blueprint.js';
import { InboxService } from './application/inbox.service.js';
import { StructureService } from './application/structure.service.js';
import { StructureController } from './presentation/structure.controller.js';

/** Navegação: workspaces, árvore de pastas/boards, favoritos, views, inbox e "Minha semana". */
@Module({
  imports: [WorkServicesModule],
  controllers: [StructureController],
  providers: [StructureService, InboxService, BoardBlueprintWriter],
})
export class StructureModule {}
