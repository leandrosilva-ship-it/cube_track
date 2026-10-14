import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { StorageService } from './storage.service.js';

@Module({
  imports: [WorkServicesModule],
  controllers: [FilesController],
  providers: [StorageService, FilesService],
})
export class FilesModule {}
