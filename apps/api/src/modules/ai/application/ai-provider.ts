import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Abstração do provedor de IA (ADR 0055): o resto do código (assistente, resumos, agentes) nunca
 * conhece o formato específico da Messages API da Anthropic — só este arquivo depende do SDK.
 * Trocar de provedor (ou mockar em teste) significa só trocar a implementação de `AiProviderClient`.
 */

export type AiMessageRole = 'user' | 'assistant';

export type AiMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface AiCompleteMessage {
  role: AiMessageRole;
  content: string | AiMessageBlock[];
}

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12) do `input` que a ferramenta aceita. */
  inputSchema: Record<string, unknown>;
}

export interface AiCompleteInput {
  /** Chave do tenant, já decifrada pelo chamador (`AiUsageGuard`) — nunca persistida aqui. */
  apiKey: string;
  model: string;
  system: string;
  messages: AiCompleteMessage[];
  tools?: AiToolSpec[];
  /** Força o modelo a chamar exatamente esta ferramenta (extração estruturada de 1 turno). */
  forceTool?: string;
  maxTokens: number;
}

export interface AiCompleteResult {
  textOutput: string | null;
  toolCalls: { id: string; name: string; input: unknown }[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
}

export interface AiProviderClient {
  complete(input: AiCompleteInput): Promise<AiCompleteResult>;
}

/** Token de injeção (permite trocar/mockar a implementação sem mudar os consumidores). */
export const AI_PROVIDER_CLIENT = Symbol('AI_PROVIDER_CLIENT');

function toContentBlock(block: AiMessageBlock): Anthropic.ContentBlockParam {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
  return {
    type: 'tool_result',
    tool_use_id: block.toolUseId,
    content: block.content,
    ...(block.isError === true ? { is_error: true } : {}),
  };
}

function toMessageParam(message: AiCompleteMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  return { role: message.role, content: message.content.map(toContentBlock) };
}

/**
 * Implementação real (Anthropic Claude). Loop de tool-use manual: esta classe só faz UMA chamada
 * (`messages.create`); o encadeamento pergunta → ferramenta → resposta final fica no chamador
 * (`AiAssistantService`), que decide quando parar — evitamos depender do `tool_runner`/beta do SDK
 * para manter o fluxo auditável passo a passo (cada chamada vira uma linha de uso/custo).
 */
@Injectable()
export class AnthropicProviderClient implements AiProviderClient {
  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const client = new Anthropic({ apiKey: input.apiKey });
    const response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: input.messages.map(toMessageParam),
      ...(input.tools === undefined
        ? {}
        : {
            tools: input.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }),
      ...(input.forceTool === undefined ? {} : { tool_choice: { type: 'tool', name: input.forceTool } }),
    });
    const toolCalls = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));
    const textOutput = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return {
      textOutput: textOutput === '' ? null : textOutput,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason,
    };
  }
}
