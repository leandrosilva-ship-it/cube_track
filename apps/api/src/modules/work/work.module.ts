import { Module } from '@nestjs/common';

import { BoardsService } from './application/boards.service.js';
import { ComputedFieldsService } from './application/computed-fields.service.js';
import { ItemsService } from './application/items.service.js';
import { BoardDefinitionRepository } from './infrastructure/board-definition.repository.js';
import { ItemsRepository } from './infrastructure/items.repository.js';
import { WorkResolver } from './presentation/graphql/work.resolver.js';
import { WorkController } from './presentation/work.controller.js';

/** Casos de uso de boards/itens (reutilizados pelo gateway realtime sem expor rotas HTTP). */
@Module({
  providers: [
    ItemsRepository,
    BoardDefinitionRepository,
    ComputedFieldsService,
    ItemsService,
    BoardsService,
  ],
  exports: [
    ItemsRepository,
    BoardDefinitionRepository,
    ComputedFieldsService,
    ItemsService,
    BoardsService,
  ],
})
export class WorkServicesModule {}

@Module({
  imports: [WorkServicesModule],
  controllers: [WorkController],
  providers: [WorkResolver],
})
export class WorkModule {}
