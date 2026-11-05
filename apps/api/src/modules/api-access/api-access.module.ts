import { Module } from '@nestjs/common';

import { ApiTokensService } from './application/api-tokens.service.js';
import { OAuthAppsService } from './application/oauth-apps.service.js';
import { MeTokensController } from './presentation/me-tokens.controller.js';
import { OAuthAppsController } from './presentation/oauth-apps.controller.js';
import { OAuthTokenController } from './presentation/oauth-token.controller.js';
import { TokensAdminController } from './presentation/tokens-admin.controller.js';

/**
 * API pública — tokens pessoais, administração de tokens do tenant e apps OAuth (`client_credentials`,
 * ADR 0056). A autenticação por token em si (`AuthGuard`/`TokenService`) e o teto de escopo
 * (`AccessService`) vivem no núcleo (`core/`), não aqui — este módulo só expõe o CRUD/emissão.
 */
@Module({
  controllers: [
    MeTokensController,
    TokensAdminController,
    OAuthAppsController,
    OAuthTokenController,
  ],
  providers: [ApiTokensService, OAuthAppsService],
})
export class ApiAccessModule {}
