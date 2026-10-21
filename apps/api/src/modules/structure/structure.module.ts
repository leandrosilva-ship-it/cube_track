import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { BoardBlueprintWriter } from './application/board-blueprint.js';
import { InboxService } from './application/inbox.service.js';
import { PublicShareService } from './application/public-share.service.js';
import { ShareLinksService } from './application/share-links.service.js';
import { StructureService } from './application/structure.service.js';
import { ShareSessionService } from './infrastructure/share-session.service.js';
import { PublicShareController } from './presentation/public-share.controller.js';
import { StructureController } from './presentation/structure.controller.js';

/**
 * Navegação: workspaces, árvore de pastas/boards, favoritos, views (+ links públicos e filtros
 * salvos), inbox e "Minha semana".
 */
@Module({
  imports: [WorkServicesModule],
  controllers: [StructureController, PublicShareController],
  providers: [
    StructureService,
    InboxService,
    BoardBlueprintWriter,
    ShareLinksService,
    PublicShareService,
    ShareSessionService,
  ],
})
export class StructureModule {}
