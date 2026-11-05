import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { ResourcesModule } from '../resources/resources.module.js';
import { ScimGroupsService, ScimUsersService } from './application/scim-users.service.js';
import { SamlService } from './application/saml.service.js';
import { SsoConfigService } from './application/sso-config.service.js';
import { SsoConfigRepository } from './infrastructure/sso-config.repository.js';
import { ScimController } from './presentation/scim.controller.js';
import { SsoController } from './presentation/sso.controller.js';

/**
 * SSO SAML 2.0 e SCIM 2.0 (ADR 0057, Prompt 16). `AccessModule` é `@Global()` (não precisa import
 * explícito); `IdentityModule` é importado por `AuthService` (sessão/provisionamento de usuário) e
 * `ResourcesModule` por `TeamsService` (grupos SCIM, somente leitura).
 */
@Module({
  imports: [IdentityModule, ResourcesModule],
  controllers: [SsoController, ScimController],
  providers: [SsoConfigRepository, SsoConfigService, SamlService, ScimUsersService, ScimGroupsService],
})
export class SsoModule {}
