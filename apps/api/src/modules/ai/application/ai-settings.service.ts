import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { encryptSecret } from '@cube-track/shared/crypto';
import { AI_MODELS, AI_PROVIDERS, DEFAULT_AI_MODEL, type AiFeature, type AiModel, type AiProvider } from '@cube-track/shared';
import { eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { AiUsageGuard } from './ai-usage-guard.service.js';

const { aiSettings } = schema;

export interface AiSettingsDto {
  provider: AiProvider;
  model: AiModel;
  enabled: boolean;
  hasApiKey: boolean;
  monthlyTokenLimit: number | null;
  monthlyCostLimitCents: number | null;
  updatedAt: string | null;
}

export interface UpdateAiSettingsInput {
  provider?: AiProvider | undefined;
  /** Texto puro — cifrada antes de salvar; nunca devolvida (ver `hasApiKey`). */
  apiKey?: string | undefined;
  model?: AiModel | undefined;
  enabled?: boolean | undefined;
  monthlyTokenLimit?: number | null | undefined;
  monthlyCostLimitCents?: number | null | undefined;
}

export interface AiUsageSummaryEntry {
  feature: AiFeature;
  tokens: number;
  costCents: number;
  calls: number;
}

/**
 * Configuração de IA do TENANT (ADR 0055) — diferente de `contracts`/`automations`, não é por
 * workspace: uma organização inteira liga/desliga a IA e configura uma única chave. `enabled` nasce
 * `false` (LGPD): só um admin que leu os termos liga explicitamente.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly usage: AiUsageGuard,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(user: AuthPrincipal): Promise<AiSettingsDto> {
    await this.access.assert(user, 'ai.manage', { type: 'tenant' });
    const row = await this.row(user.tenantId);
    return this.toDto(row);
  }

  async usageSummary(user: AuthPrincipal): Promise<AiUsageSummaryEntry[]> {
    await this.access.assert(user, 'ai.manage', { type: 'tenant' });
    return this.usage.monthlyTotalsByFeature(user.tenantId);
  }

  async update(user: AuthPrincipal, input: UpdateAiSettingsInput): Promise<AiSettingsDto> {
    await this.access.assert(user, 'ai.manage', { type: 'tenant' });
    if (input.apiKey !== undefined && input.apiKey.trim().length < 8) {
      throw new ValidationError([{ path: 'body.apiKey', message: 'Chave de API inválida.' }]);
    }
    const existing = await this.row(user.tenantId);
    const [row] = await this.runner.tx
      .insert(aiSettings)
      .values({
        tenantId: user.tenantId,
        provider: input.provider ?? existing?.provider ?? 'anthropic',
        apiKeyCiphertext:
          input.apiKey !== undefined
            ? encryptSecret(input.apiKey.trim(), this.config.ENCRYPTION_KEY)
            : (existing?.apiKeyCiphertext ?? null),
        model: input.model ?? existing?.model ?? DEFAULT_AI_MODEL,
        enabled: input.enabled ?? existing?.enabled ?? false,
        monthlyTokenLimit:
          input.monthlyTokenLimit === undefined ? (existing?.monthlyTokenLimit ?? null) : input.monthlyTokenLimit,
        monthlyCostLimitCents:
          input.monthlyCostLimitCents === undefined
            ? (existing?.monthlyCostLimitCents ?? null)
            : input.monthlyCostLimitCents,
        updatedBy: user.userId,
      })
      .onConflictDoUpdate({
        target: aiSettings.tenantId,
        set: {
          provider: input.provider ?? existing?.provider ?? 'anthropic',
          ...(input.apiKey !== undefined
            ? { apiKeyCiphertext: encryptSecret(input.apiKey.trim(), this.config.ENCRYPTION_KEY) }
            : {}),
          model: input.model ?? existing?.model ?? DEFAULT_AI_MODEL,
          enabled: input.enabled ?? existing?.enabled ?? false,
          monthlyTokenLimit:
            input.monthlyTokenLimit === undefined ? (existing?.monthlyTokenLimit ?? null) : input.monthlyTokenLimit,
          monthlyCostLimitCents:
            input.monthlyCostLimitCents === undefined
              ? (existing?.monthlyCostLimitCents ?? null)
              : input.monthlyCostLimitCents,
          updatedBy: user.userId,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao salvar a configuração de IA.');
    this.events.recordChange({
      action: 'ai_settings.update',
      entityType: 'ai_settings',
      entityId: row.id,
      after: {
        provider: row.provider,
        model: row.model,
        enabled: row.enabled,
        hasApiKey: row.apiKeyCiphertext !== null,
        monthlyTokenLimit: row.monthlyTokenLimit,
        monthlyCostLimitCents: row.monthlyCostLimitCents,
      },
    });
    return this.toDto(row);
  }

  private async row(tenantId: string) {
    const [row] = await this.runner.tx.select().from(aiSettings).where(eq(aiSettings.tenantId, tenantId));
    return row;
  }

  private toDto(row: typeof aiSettings.$inferSelect | undefined): AiSettingsDto {
    if (row === undefined) {
      return {
        provider: 'anthropic',
        model: DEFAULT_AI_MODEL,
        enabled: false,
        hasApiKey: false,
        monthlyTokenLimit: null,
        monthlyCostLimitCents: null,
        updatedAt: null,
      };
    }
    return {
      provider: (AI_PROVIDERS as readonly string[]).includes(row.provider) ? (row.provider as AiProvider) : 'anthropic',
      model: (AI_MODELS as readonly string[]).includes(row.model) ? (row.model as AiModel) : DEFAULT_AI_MODEL,
      enabled: row.enabled,
      hasApiKey: row.apiKeyCiphertext !== null,
      monthlyTokenLimit: row.monthlyTokenLimit,
      monthlyCostLimitCents: row.monthlyCostLimitCents,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
