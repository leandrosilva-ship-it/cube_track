import { Global, Module } from '@nestjs/common';

import { AccessAdminService } from './application/access-admin.service.js';
import { AccessService } from './application/access.service.js';
import { AccessRepository } from './infrastructure/access.repository.js';
import { AccessController } from './presentation/access.controller.js';

@Global()
@Module({
  controllers: [AccessController],
  providers: [AccessRepository, AccessService, AccessAdminService],
  exports: [AccessService],
})
export class AccessModule {}
