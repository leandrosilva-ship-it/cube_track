import { Module } from '@nestjs/common';

import { BoardsService } from './application/boards.service.js';
import { ColumnsService } from './application/columns.service.js';
import { ComputedFieldsService } from './application/computed-fields.service.js';
import { GroupsService } from './application/groups.service.js';
import { ImportExportService } from './application/import-export.service.js';
import { ItemWriter } from './application/item-writer.js';
import { ItemsService } from './application/items.service.js';
import { BoardDefinitionRepository } from './infrastructure/board-definition.repository.js';
import { ItemsRepository } from './infrastructure/items.repository.js';
import { WorkResolver } from './presentation/graphql/work.resolver.js';
import { BoardContentController } from './presentation/board-content.controller.js';
import { WorkController } from './presentation/work.controller.js';

/** Casos de uso de boards/itens (reutilizados pelo gateway realtime sem expor rotas HTTP). */
@Module({
  providers: [
    ItemsRepository,
    BoardDefinitionRepository,
    ComputedFieldsService,
    ItemWriter,
    ItemsService,
    ColumnsService,
    GroupsService,
    ImportExportService,
    BoardsService,
  ],
  exports: [
    ItemsRepository,
    BoardDefinitionRepository,
    ComputedFieldsService,
    ItemWriter,
    ItemsService,
    ColumnsService,
    GroupsService,
    ImportExportService,
    BoardsService,
  ],
})
export class WorkServicesModule {}

@Module({
  imports: [WorkServicesModule],
  controllers: [WorkController, BoardContentController],
  providers: [WorkResolver],
})
export class WorkModule {}
