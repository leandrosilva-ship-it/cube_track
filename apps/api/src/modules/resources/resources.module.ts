import { Module } from '@nestjs/common';

import { AbsencesService } from './application/absences.service.js';
import { AllocationsService } from './application/allocations.service.js';
import { CapacityService } from './application/capacity.service.js';
import { ResourceProfilesService } from './application/resource-profiles.service.js';
import { ResourceRequestsService } from './application/resource-requests.service.js';
import { SkillsService } from './application/skills.service.js';
import { TeamsService } from './application/teams.service.js';
import { ResourcesController } from './presentation/resources.controller.js';

/** Perfis de recurso, skills, times, alocações, ausências, solicitações e motor de capacidade (ADR 0052). */
@Module({
  controllers: [ResourcesController],
  providers: [
    ResourceProfilesService,
    SkillsService,
    TeamsService,
    AllocationsService,
    AbsencesService,
    ResourceRequestsService,
    CapacityService,
  ],
  exports: [AllocationsService, AbsencesService, CapacityService],
})
export class ResourcesModule {}
