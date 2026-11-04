import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { decryptSecret } from '@cube-track/shared/crypto';
import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  estimateCostCents,
  isOverUsageLimit,
  type AiFeature,
  type AiModel,
} from '@cube-track/shared';
import { and, eq, gte, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { UnprocessableError } from '../../../core/errors/problems.js';

const { aiSettings, aiUsageLogs } = schema;

export interface AiCallContext {
  apiKey: string;
  model: AiModel;
}

function asModel(value: string): AiModel {
  return (AI_MODELS as readonly string[]).includes(value) ? (value as AiModel) : DEFAULT_AI_MODEL;
}

/** Início (UTC) do mês corrente — janela usada para somar o uso/custo mensal do tenant. */
function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Guarda central de toda chamada de IA (ADR 0055): antes de chamar o provedor, garante que a IA está
 * habilitada e configurada para o tenant (`ai_not_configured`) e que o limite mensal de uso não foi
 * estourado (`ai_usage_limit_exceeded`) — isso acontece ANTES de qualquer chamada à Anthropic, nunca
 * depois. Depois da chamada, `record` grava a linha de uso/custo (sucesso ou erro) — a auditoria de
 * custo/LGPD exigida pelo Prompt 14. Único ponto de decriptação da chave do tenant.
 */
@Injectable()
export class AiUsageGuard {
  constructor(
    private readonly runner: TransactionRunner,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Verifica habilitação + limite e devolve a chave decifrada e o modelo configurado do tenant. */
  async requireReady(tenantId: string): Promise<AiCallContext> {
    const [settings] = await this.runner.tx
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.tenantId, tenantId));
    if (settings === undefined || !settings.enabled || settings.apiKeyCiphertext === null) {
      throw new UnprocessableError(
        'A IA não está habilitada ou configurada para esta organização.',
        'ai_not_configured',
      );
    }
    const totals = await this.monthlyTotals(tenantId);
    if (
      isOverUsageLimit(totals, {
        monthlyTokenLimit: settings.monthlyTokenLimit,
        monthlyCostLimitCents: settings.monthlyCostLimitCents,
      })
    ) {
      throw new UnprocessableError(
        'O limite mensal de uso de IA desta organização foi atingido.',
        'ai_usage_limit_exceeded',
      );
    }
    const apiKey = decryptSecret(settings.apiKeyCiphertext, this.config.ENCRYPTION_KEY);
    return { apiKey, model: asModel(settings.model) };
  }

  /** Soma de tokens/custo do mês corrente (tudo em `ai_usage_logs`, inclusive chamadas com erro). */
  async monthlyTotals(tenantId: string, now: Date = new Date()): Promise<{ tokens: number; costCents: number }> {
    const [row] = await this.runner.tx
      .select({
        tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}), 0)::int`,
        costCents: sql<number>`coalesce(sum(${aiUsageLogs.costCents}), 0)::int`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.tenantId, tenantId), gte(aiUsageLogs.createdAt, startOfMonth(now))));
    return { tokens: row?.tokens ?? 0, costCents: row?.costCents ?? 0 };
  }

  /** Uso do mês corrente agrupado por funcionalidade — alimenta `GET /v1/ai/settings/usage`. */
  async monthlyTotalsByFeature(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<{ feature: AiFeature; tokens: number; costCents: number; calls: number }[]> {
    const rows = await this.runner.tx
      .select({
        feature: aiUsageLogs.feature,
        tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}), 0)::int`,
        costCents: sql<number>`coalesce(sum(${aiUsageLogs.costCents}), 0)::int`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.tenantId, tenantId), gte(aiUsageLogs.createdAt, startOfMonth(now))))
      .groupBy(aiUsageLogs.feature);
    return rows;
  }

  /** Grava a linha de uso/custo — chamado sempre após a chamada ao provedor, sucesso ou erro. */
  async record(input: {
    tenantId: string;
    userId: string | null;
    feature: AiFeature;
    model: AiModel;
    inputTokens: number;
    outputTokens: number;
    cached?: boolean;
  }): Promise<number> {
    const costCents = estimateCostCents(input.model, input.inputTokens, input.outputTokens);
    await this.runner.tx.insert(aiUsageLogs).values({
      tenantId: input.tenantId,
      userId: input.userId,
      feature: input.feature,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costCents,
      cached: input.cached ?? false,
    });
    return costCents;
  }
}
