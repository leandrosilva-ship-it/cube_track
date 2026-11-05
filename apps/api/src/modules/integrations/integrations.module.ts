import { Module } from '@nestjs/common';

import { WorkServicesModule } from '../work/work.module.js';
import { ChatService } from './application/chat.service.js';
import { ConnectionsService } from './application/connections.service.js';
import { DevEventsService } from './application/dev-events.service.js';
import { GoogleMicrosoftService } from './application/google-microsoft.service.js';
import { HttpOAuthConnectionClient, OAUTH_CONNECTION_CLIENT } from './infrastructure/oauth-connection.client.js';
import { PublicConnectionResolver } from './infrastructure/public-connection-resolver.js';
import { ChatController } from './presentation/chat.controller.js';
import { ConnectionsController } from './presentation/connections.controller.js';
import { DevEventsController } from './presentation/dev-events.controller.js';
import { GoogleMicrosoftController } from './presentation/google-microsoft.controller.js';

/**
 * Integrações de terceiros (Prompt 15, parte 3, ADR 0056): Google Workspace/Microsoft 365 (OAuth,
 * calendário, Drive/OneDrive por referência, e-mail-para-item), Slack/Microsoft Teams (notificação de
 * saída, comando de barra, link preview) e GitHub/GitLab/Azure DevOps (webhook de entrada → vínculo de
 * item e auto-avanço de status). Toda credencial é BYOK (ver `packages/shared/src/integrations.ts`).
 */
@Module({
  imports: [WorkServicesModule],
  controllers: [ConnectionsController, GoogleMicrosoftController, ChatController, DevEventsController],
  providers: [
    ConnectionsService,
    GoogleMicrosoftService,
    ChatService,
    DevEventsService,
    PublicConnectionResolver,
    { provide: OAUTH_CONNECTION_CLIENT, useClass: HttpOAuthConnectionClient },
  ],
})
export class IntegrationsModule {}
