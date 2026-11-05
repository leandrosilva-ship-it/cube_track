import { Module } from '@nestjs/common';

import { AuthAudit } from './application/auth-audit.js';
import { AuthService } from './application/auth.service.js';
import { InvitationService } from './application/invitation.service.js';
import { MfaService } from './application/mfa.service.js';
import { SecurityPolicyService } from './application/security-policy.service.js';
import { SessionService } from './application/session.service.js';
import { IdentityRepository } from './infrastructure/identity.repository.js';
import { OAuthClient } from './infrastructure/oauth.client.js';
import { SecurityPolicyRepository } from './infrastructure/security-policy.repository.js';
import { AuthController } from './presentation/auth.controller.js';
import { InvitationsController } from './presentation/invitations.controller.js';
import { MeController } from './presentation/me.controller.js';
import { SecurityPolicyController } from './presentation/security-policy.controller.js';

@Module({
  controllers: [AuthController, MeController, InvitationsController, SecurityPolicyController],
  providers: [
    IdentityRepository,
    OAuthClient,
    AuthAudit,
    SessionService,
    MfaService,
    AuthService,
    InvitationService,
    SecurityPolicyRepository,
    SecurityPolicyService,
  ],
  exports: [SecurityPolicyService],
})
export class IdentityModule {}
