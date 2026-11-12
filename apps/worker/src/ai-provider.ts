import Anthropic from '@anthropic-ai/sdk';
import { PROMPT_INJECTION_GUARD, wrapUntrustedContent } from '@cube-track/shared';

/**
 * Chamada à Anthropic para a DECISÃO de um agente de IA (ADR 0055). Implementação mínima própria
 * (não reaproveita `apps/api/src/modules/ai/application/ai-provider.ts`): o worker não tem o Nest DI
 * da API, e aqui basta UMA chamada de 1 turno com saída estruturada (ferramenta forçada), sem o loop
 * de tool-use do assistente — duplicar esta interface pequena é mais simples do que compartilhar a
 * classe `AnthropicProviderClient` entre os dois processos.
 */

export interface AgentDecisionInput {
  apiKey: string;
  model: string;
  instructions: string;
  /** Tipos de ação que o agente tem permissão de propor (`AutomationActionType[]`, como texto). */
  allowedActions: readonly string[];
  /** Contexto do item/board já serializado (JSON) — será delimitado como dado não confiável. */
  itemContext: string;
  columns: { key: string; title: string; type: string; options: string[] }[];
  groups: { id: string; name: string }[];
}

export type AgentDecisionAction =
  | { type: 'no_action' }
  | { type: 'set_column_value'; columnKey: string; textValue: string }
  | { type: 'move_to_group'; groupId: string }
  | { type: 'notify'; message: string };

export interface AgentDecisionResult {
  reasoning: string;
  action: AgentDecisionAction;
  usage: { inputTokens: number; outputTokens: number };
}

const TOOL_NAME = 'decide';
const MAX_TOKENS = 600;

function systemPrompt(input: AgentDecisionInput): string {
  return [
    'Você é um agente de automação do CUBE PROJECT que decide, a partir de um evento de item de board,',
    'se deve propor UMA ação (nunca executa sozinho — toda ação passa por aprovação humana antes de',
    'acontecer de verdade). Se não houver uma ação clara a propor, responda action="no_action".',
    `Ações permitidas por esta configuração: ${input.allowedActions.join(', ')}.`,
    input.columns.length === 0
      ? ''
      : `Colunas disponíveis (use a "key" exata): ${JSON.stringify(input.columns)}.`,
    input.groups.length === 0 ? '' : `Grupos disponíveis (use o "id" exato): ${JSON.stringify(input.groups)}.`,
    'Instruções configuradas para este agente:',
    wrapUntrustedContent('agent_instructions', input.instructions),
    PROMPT_INJECTION_GUARD,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function decideAgentAction(input: AgentDecisionInput): Promise<AgentDecisionResult> {
  const client = new Anthropic({ apiKey: input.apiKey });
  const response = await client.messages.create({
    model: input.model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt(input),
    tool_choice: { type: 'tool', name: TOOL_NAME },
    tools: [
      {
        name: TOOL_NAME,
        description: 'Registra a decisão do agente sobre o evento.',
        input_schema: {
          type: 'object',
          properties: {
            reasoning: { type: 'string', description: 'Explicação curta, mostrada ao aprovador humano.' },
            action: {
              type: 'string',
              enum: ['no_action', ...input.allowedActions],
            },
            columnKey: { type: 'string', description: 'Obrigatório quando action = set_column_value.' },
            textValue: {
              type: 'string',
              description: 'Texto bruto do novo valor (não o JSON da célula) quando action = set_column_value.',
            },
            groupId: { type: 'string', description: 'Id do grupo de destino quando action = move_to_group.' },
            message: { type: 'string', description: 'Mensagem de notificação quando action = notify.' },
          },
          required: ['reasoning', 'action'],
        },
      },
    ],
    messages: [{ role: 'user', content: wrapUntrustedContent('event_context', input.itemContext) }],
  });
  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  const block = response.content.find(
    (entry): entry is Anthropic.ToolUseBlock => entry.type === 'tool_use',
  );
  if (block === undefined) return { reasoning: '', action: { type: 'no_action' }, usage };
  const raw = block.input as Record<string, unknown>;
  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, 4_000) : '';
  const actionType = typeof raw.action === 'string' ? raw.action : 'no_action';
  if (actionType === 'set_column_value' && typeof raw.columnKey === 'string' && typeof raw.textValue === 'string') {
    return { reasoning, action: { type: 'set_column_value', columnKey: raw.columnKey, textValue: raw.textValue }, usage };
  }
  if (actionType === 'move_to_group' && typeof raw.groupId === 'string') {
    return { reasoning, action: { type: 'move_to_group', groupId: raw.groupId }, usage };
  }
  if (actionType === 'notify' && typeof raw.message === 'string') {
    return { reasoning, action: { type: 'notify', message: raw.message.slice(0, 500) }, usage };
  }
  return { reasoning, action: { type: 'no_action' }, usage };
}
