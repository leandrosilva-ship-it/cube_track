import { Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { AiSettingsService } from '../application/ai-settings.service.js';
import * as S from './schemas.js';

/** Configuração de IA do TENANT (ADR 0055) — chave/modelo/limites, não por workspace. */
@Controller('ai/settings')
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get()
  @Endpoint({
    summary: 'Obter a configuração de IA da organização',
    description: 'Requer `ai.manage`. Nunca devolve a chave em texto puro (ver `hasApiKey`).',
    tags: ['ai'],
    response: S.AiSettingsSchema,
  })
  get(@CurrentPrincipal() user: AuthPrincipal) {
    return this.settings.get(user);
  }

  @Patch()
  @Audited({ action: 'ai_settings.update', entityType: 'ai_settings' })
  @Endpoint({
    summary: 'Atualizar a configuração de IA da organização',
    description: 'Requer `ai.manage`. `apiKey` é cifrada antes de salvar.',
    tags: ['ai'],
    body: S.UpdateAiSettingsBody,
    response: S.AiSettingsSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.UpdateAiSettingsBody>,
  ) {
    return this.settings.update(user, body);
  }

  @Get('usage')
  @Endpoint({
    summary: 'Uso/custo de IA do mês corrente, por funcionalidade',
    description: 'Requer `ai.manage`.',
    tags: ['ai'],
    response: z.object({ data: z.array(S.AiUsageEntrySchema) }),
  })
  async usage(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.settings.usageSummary(user) };
  }
}
