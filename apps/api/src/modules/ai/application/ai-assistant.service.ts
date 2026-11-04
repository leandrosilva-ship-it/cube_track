import { Inject, Injectable } from '@nestjs/common';
import { PROMPT_INJECTION_GUARD, wrapUntrustedContent } from '@cube-track/shared';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { AppError, UnprocessableError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { AI_PROVIDER_CLIENT, type AiCompleteMessage, type AiProviderClient } from './ai-provider.js';
import { AiAssistantToolsService } from './ai-assistant-tools.service.js';
import { AiModuleGuard } from './ai-module-guard.service.js';
import { AiUsageGuard } from './ai-usage-guard.service.js';

/** Limite de idas e vindas pergunta → ferramenta → resposta (evita loops/custo descontrolado). */
const MAX_TURNS = 6;
const MAX_TOKENS = 1_500;

export interface AiAssistantResult {
  answer: string;
  toolCalls: string[];
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM_PROMPT =
  'Você é o assistente de IA do CUBE TRACK, uma plataforma de gestão de projetos e processos. ' +
  'Responda em português do Brasil, de forma objetiva, usando SOMENTE as ferramentas disponíveis ' +
  'para consultar dados — nunca invente números, nomes ou status. Se uma ferramenta não encontrar ' +
  'dados ou devolver um erro de permissão, diga isso claramente em vez de supor um valor. ' +
  PROMPT_INJECTION_GUARD;

/**
 * Assistente lateral (chat síncrono, ADR 0055): loop manual de tool-use. As ferramentas chamam
 * services reais com o `AuthPrincipal` de quem pergunta (`AiAssistantToolsService`), o que garante
 * por construção que a resposta nunca inclui dado que o usuário não tem permissão de ver — o módulo
 * de IA não tem acesso direto ao banco.
 */
@Injectable()
export class AiAssistantService {
  constructor(
    @Inject(AI_PROVIDER_CLIENT) private readonly provider: AiProviderClient,
    private readonly tools: AiAssistantToolsService,
    private readonly usageGuard: AiUsageGuard,
    private readonly moduleGuard: AiModuleGuard,
    private readonly access: AccessService,
  ) {}

  async ask(user: AuthPrincipal, boardId: string, question: string): Promise<AiAssistantResult> {
    const { workspaceId, enabledModules } = await this.moduleGuard.assertBoardEnabled(boardId);
    await this.access.assert(user, 'ai.use', { type: 'workspace', id: workspaceId });
    const call = await this.usageGuard.requireReady(user.tenantId);
    const toolSpecs = this.tools.toolsFor(enabledModules);
    const messages: AiCompleteMessage[] = [
      { role: 'user', content: wrapUntrustedContent('question', question) },
    ];
    const usedTools: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let answer = '';
    let failure: unknown;
    try {
      for (let turn = 0; turn < MAX_TURNS; turn += 1) {
        const result = await this.provider.complete({
          apiKey: call.apiKey,
          model: call.model,
          system: SYSTEM_PROMPT,
          messages,
          tools: toolSpecs,
          maxTokens: MAX_TOKENS,
        });
        totalInputTokens += result.usage.inputTokens;
        totalOutputTokens += result.usage.outputTokens;
        if (result.toolCalls.length === 0) {
          answer = result.textOutput ?? '';
          break;
        }
        messages.push({
          role: 'assistant',
          content: [
            ...(result.textOutput !== null ? [{ type: 'text' as const, text: result.textOutput }] : []),
            ...result.toolCalls.map((call_) => ({
              type: 'tool_use' as const,
              id: call_.id,
              name: call_.name,
              input: call_.input,
            })),
          ],
        });
        const toolResults: AiCompleteMessage['content'] = [];
        for (const toolCall of result.toolCalls) {
          usedTools.push(toolCall.name);
          try {
            const output = await this.tools.execute(user, { boardId, workspaceId }, toolCall.name, toolCall.input);
            toolResults.push({ type: 'tool_result', toolUseId: toolCall.id, content: output });
          } catch (error) {
            const message = error instanceof AppError ? error.detail : 'Falha ao executar a ferramenta.';
            toolResults.push({ type: 'tool_result', toolUseId: toolCall.id, content: message, isError: true });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        if (turn === MAX_TURNS - 1) {
          answer =
            'Não consegui concluir a resposta dentro do limite de etapas. Tente reformular a pergunta ' +
            'de forma mais específica.';
        }
      }
    } catch (error) {
      failure = error;
    }
    await this.usageGuard.record({
      tenantId: user.tenantId,
      userId: user.userId,
      feature: 'assistant',
      model: call.model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    });
    if (failure !== undefined) {
      throw failure instanceof AppError
        ? failure
        : new UnprocessableError('Falha ao consultar o provedor de IA.', 'ai_provider_error');
    }
    return {
      answer,
      toolCalls: usedTools,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    };
  }
}
