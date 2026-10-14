import { Module } from '@nestjs/common';

import { SearchController, SearchResolver } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  controllers: [SearchController],
  providers: [SearchService, SearchResolver],
})
export class SearchModule {}
