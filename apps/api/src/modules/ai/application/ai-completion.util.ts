import { PROMPT_INJECTION_GUARD } from '@cube-track/shared';

import type { AiProviderClient } from './ai-provider.js';

/** Chamada de 1 turno, sem ferramentas: texto livre de entrada → texto livre de saída. */
export async function completeText(
  provider: AiProviderClient,
  apiKey: string,
  model: string,
  system: string,
  userContent: string,
  maxTokens = 800,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const result = await provider.complete({
    apiKey,
    model,
    system: `${system} ${PROMPT_INJECTION_GUARD}`,
    maxTokens,
    messages: [{ role: 'user', content: userContent }],
  });
  return {
    text: result.textOutput ?? '',
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  };
}
