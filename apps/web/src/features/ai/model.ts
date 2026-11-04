import { isRevertibleActionType, type AiAgentRunStatus, type AutomationActionType } from '@cube-track/shared';

/**
 * Helpers puros do módulo de IA (ADR 0055/Prompt 14): conversão de limites monetários (centavos ↔
 * unidade inteira, para o formulário de configuração), seleção de "ações permitidas" do agente
 * (até 3) e classificação visual do status de uma execução de agente. Sem I/O — testável sem rede.
 */

// --------------------------------------------------------------------------- centavos ↔ moeda ---

/** Centavos (inteiro, como a API guarda `monthlyCostLimitCents`) → string editável em unidades. */
export function centsToUnits(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2);
}

/** String do formulário (unidades, aceita vírgula) → centavos inteiros, ou `null` se vazio/inválido. */
export function unitsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

// ----------------------------------------------------------------------------- ações do agente ---

export const MAX_AGENT_ALLOWED_ACTIONS = 3;

/** Alterna `action` no conjunto de ações permitidas do agente, respeitando o limite (padrão 3). */
export function toggleAllowedAction(
  current: readonly AutomationActionType[],
  action: AutomationActionType,
  max: number = MAX_AGENT_ALLOWED_ACTIONS,
): AutomationActionType[] {
  if (current.includes(action)) return current.filter((entry) => entry !== action);
  if (current.length >= max) return [...current];
  return [...current, action];
}

// ---------------------------------------------------------------------------- status de execução ---

const RUN_STATUS_TONE: Record<AiAgentRunStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  pending_approval: 'warning',
  approved: 'info',
  rejected: 'danger',
  executed: 'success',
  failed: 'danger',
  reverted: 'neutral',
};

/** Tom de `Badge` (design system) para o status de uma execução de agente de IA. */
export function runStatusTone(status: AiAgentRunStatus): 'neutral' | 'warning' | 'success' | 'danger' | 'info' {
  return RUN_STATUS_TONE[status];
}

/** Uma proposta só pode ser revertida se foi executada e a ação é de um tipo revertível. */
export function isRunRevertible(run: {
  status: AiAgentRunStatus;
  proposedAction: { type: AutomationActionType };
}): boolean {
  return run.status === 'executed' && isRevertibleActionType(run.proposedAction.type);
}

// ------------------------------------------------------------------------------ previsões/risco ---

/** Tom de `Badge` para o status de risco de atraso de um item nas previsões. */
export function delayRiskTone(status: 'overdue' | 'due_soon'): 'danger' | 'warning' {
  return status === 'overdue' ? 'danger' : 'warning';
}

/** Similaridade (0–1) formatada como porcentagem inteira para exibição. */
export function similarityPercent(similarity: number): number {
  return Math.round(similarity * 100);
}
