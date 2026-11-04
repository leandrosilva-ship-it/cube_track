import { Module } from '@nestjs/common';

import { CollaborationModule } from '../collaboration/collaboration.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { PortfolioModule } from '../portfolio/portfolio.module.js';
import { WorkServicesModule } from '../work/work.module.js';
import { AiAgentsService } from './application/ai-agents.service.js';
import { AiAssistantToolsService } from './application/ai-assistant-tools.service.js';
import { AiAssistantService } from './application/ai-assistant.service.js';
import { AiContentService } from './application/ai-content.service.js';
import { AiItemCreationService } from './application/ai-item-creation.service.js';
import { AiModuleGuard } from './application/ai-module-guard.service.js';
import { AI_PROVIDER_CLIENT, AnthropicProviderClient } from './application/ai-provider.js';
import { AiPredictionsService } from './application/ai-predictions.service.js';
import { AiSettingsService } from './application/ai-settings.service.js';
import { AiUsageGuard } from './application/ai-usage-guard.service.js';
import { AiAgentsController } from './presentation/ai-agents.controller.js';
import { AiSettingsController } from './presentation/ai-settings.controller.js';
import { AiController } from './presentation/ai.controller.js';

/**
 * Módulo de Inteligência Artificial (ADR 0055, Prompt 14): provedor Anthropic com abstração
 * (`AI_PROVIDER_CLIENT`), chave/limites por TENANT (`AiSettingsService`/`AiUsageGuard`), assistente
 * com tool-use sobre services reais (`AiAssistantService`), criação de item por texto, resumos,
 * descrição, previsões determinísticas e agentes configuráveis com aprovação humana obrigatória.
 * Estrutura enxuta (só `application`/`presentation`), mesmo precedente já aceito pelo módulo
 * `contracts` (Prompt 13) — sem `domain`/`infrastructure` próprios, pois as regras de domínio reais
 * (motor de gatilho/ação, conversão de célula) já vivem em `packages/shared` e `work`/`portfolio`.
 */
@Module({
  imports: [WorkServicesModule, CollaborationModule, PortfolioModule, ContractsModule],
  controllers: [AiSettingsController, AiController, AiAgentsController],
  providers: [
    { provide: AI_PROVIDER_CLIENT, useClass: AnthropicProviderClient },
    AiUsageGuard,
    AiModuleGuard,
    AiSettingsService,
    AiAssistantToolsService,
    AiAssistantService,
    AiItemCreationService,
    AiContentService,
    AiPredictionsService,
    AiAgentsService,
  ],
})
export class AiModule {}
