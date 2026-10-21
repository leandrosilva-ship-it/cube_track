import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { ActivityService } from './application/activity.service.js';
import { ApprovalsService } from './application/approvals.service.js';
import { ChecklistsService } from './application/checklists.service.js';
import { FollowsService } from './application/follows.service.js';
import { MailInboundService } from './application/mail-inbound.service.js';
import { UpdatesService } from './application/updates.service.js';
import { ReplyTokenService } from './infrastructure/reply-token.js';
import { CollaborationController } from './presentation/collaboration.controller.js';
import { InboundEmailController } from './presentation/inbound-email.controller.js';

/**
 * Painel do item (ADR 0048): atualizações/respostas/reações com @menções, log de atividade,
 * checklists, dependências, seguir e aprovações. Arquivos reaproveitam o módulo `files` existente.
 */
@Module({
  imports: [WorkServicesModule],
  controllers: [CollaborationController, InboundEmailController],
  providers: [
    UpdatesService,
    ActivityService,
    ChecklistsService,
    FollowsService,
    ApprovalsService,
    ReplyTokenService,
    MailInboundService,
  ],
  exports: [ReplyTokenService],
})
export class CollaborationModule {}
