import { Inject, Injectable } from '@nestjs/common';
import { wrapUntrustedContent, type AiModel } from '@cube-track/shared';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { AppError, UnprocessableError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { UpdatesService } from '../../collaboration/application/updates.service.js';
import { StatusReportService } from '../../portfolio/application/status-report.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import { completeText } from './ai-completion.util.js';
import { AI_PROVIDER_CLIENT, type AiProviderClient } from './ai-provider.js';
import { AiModuleGuard } from './ai-module-guard.service.js';
import { AiUsageGuard } from './ai-usage-guard.service.js';

/**
 * Conteúdo gerado por IA de 1 chamada (sem ferramentas): resumo de atualizações do item, narração do
 * status report (dados já calculados por `StatusReportService`, nunca recalculados aqui) e geração de
 * descrição de serviço — sempre sugerida, nunca salva sozinha (o front decide se aplica).
 */
@Injectable()
export class AiContentService {
  constructor(
    @Inject(AI_PROVIDER_CLIENT) private readonly provider: AiProviderClient,
    private readonly updates: UpdatesService,
    private readonly items: ItemsService,
    private readonly statusReport: StatusReportService,
    private readonly access: AccessService,
    private readonly usageGuard: AiUsageGuard,
    private readonly moduleGuard: AiModuleGuard,
  ) {}

  async summarizeItemUpdates(user: AuthPrincipal, itemId: string): Promise<{ summary: string }> {
    const { workspaceId } = await this.moduleGuard.assertItemEnabled(itemId);
    await this.access.assert(user, 'ai.use', { type: 'workspace', id: workspaceId });
    const call = await this.usageGuard.requireReady(user.tenantId);
    const feed = await this.updates.listFeed(user, itemId, { limit: 50 });
    const entries = [...feed.pinned, ...feed.data]
      .slice(0, 50)
      .map((entry) => `- ${entry.authorName ?? 'Alguém'}: ${entry.bodyText}`)
      .join('\n');
    const content =
      entries === ''
        ? wrapUntrustedContent('updates', 'Nenhuma atualização registrada ainda.')
        : wrapUntrustedContent('updates', entries);
    return this.run(user, call.apiKey, call.model, 'summary', content, this.summaryPrompt());
  }

  async statusReportSummary(user: AuthPrincipal, boardId: string): Promise<{ summary: string }> {
    const { workspaceId } = await this.moduleGuard.assertBoardEnabled(boardId);
    await this.access.assert(user, 'ai.use', { type: 'workspace', id: workspaceId });
    const call = await this.usageGuard.requireReady(user.tenantId);
    const report = await this.statusReport.forBoard(user, boardId);
    const content = wrapUntrustedContent(
      'status_report',
      JSON.stringify({
        board: report.boardName,
        percentComplete: report.percentComplete,
        health: report.health.latest?.overall ?? 'sem avaliação',
        evm: report.evm,
        budget: report.budget,
        openRisks: report.openRisks.map((risk) => ({ title: risk.title, impact: risk.impact, probability: risk.probability })),
        openIssues: report.openIssues.map((issue) => ({ title: issue.title, severity: issue.severity })),
        stageGates: report.stageGates.map((gate) => ({ name: gate.name, status: gate.status })),
      }),
    );
    return this.run(
      user,
      call.apiKey,
      call.model,
      'summary',
      content,
      'Narre em português, em 1-2 parágrafos objetivos, o status report a seguir (dados JÁ calculados — ' +
        'não recalcule EVM, risco ou saúde; apenas explique o que os números significam para quem lê).',
    );
  }

  async generateDescription(user: AuthPrincipal, itemId: string): Promise<{ description: string }> {
    const { workspaceId } = await this.moduleGuard.assertItemEnabled(itemId);
    await this.access.assert(user, 'ai.use', { type: 'workspace', id: workspaceId });
    const call = await this.usageGuard.requireReady(user.tenantId);
    const item = await this.items.get(user, itemId);
    const content = wrapUntrustedContent(
      'item',
      JSON.stringify({ name: item.name, currentDescription: item.descriptionText, values: item.values }),
    );
    const { text, inputTokens, outputTokens } = await completeText(
      this.provider,
      call.apiKey,
      call.model,
      'Escreva uma descrição de serviço objetiva e profissional (3-6 frases, português do Brasil) ' +
        'para o item de board a seguir, com base no nome e nos campos já preenchidos. Não invente ' +
        'prazos, valores ou responsáveis que não estejam nos dados.',
      content,
    );
    await this.usageGuard.record({
      tenantId: user.tenantId,
      userId: user.userId,
      feature: 'description',
      model: call.model,
      inputTokens,
      outputTokens,
    });
    return { description: text };
  }

  private summaryPrompt(): string {
    return (
      'Resuma em português, em um parágrafo curto, as atualizações recentes do item a seguir para ' +
      'quem precisa se atualizar rapidamente sobre o andamento.'
    );
  }

  private async run(
    user: AuthPrincipal,
    apiKey: string,
    model: AiModel,
    feature: 'summary',
    content: string,
    system: string,
  ): Promise<{ summary: string }> {
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let failure: unknown;
    try {
      const result = await completeText(this.provider, apiKey, model, system, content);
      text = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch (error) {
      failure = error;
    }
    await this.usageGuard.record({ tenantId: user.tenantId, userId: user.userId, feature, model, inputTokens, outputTokens });
    if (failure !== undefined) {
      throw failure instanceof AppError
        ? failure
        : new UnprocessableError('Falha ao consultar o provedor de IA.', 'ai_provider_error');
    }
    return { summary: text };
  }
}
