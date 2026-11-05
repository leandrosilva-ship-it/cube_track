import { isDoneLikeStatusLabel } from '@cube-track/shared/integrations';

/** Um rótulo de uma coluna de status candidata ao auto-avanço. */
export interface StatusLabelCandidate {
  id: string;
  label: string;
  /** Categoria estruturada do rótulo (`status_labels.category`) — quando marcada `'done'`, é o sinal
   * mais confiável de "isto significa concluído" (melhor que adivinhar pelo texto do rótulo). */
  category: 'not_started' | 'in_progress' | 'done' | 'stuck';
}

export interface StatusColumnCandidate {
  columnKey: string;
  labels: readonly StatusLabelCandidate[];
  /** `labelId` atual do item nesta coluna (`null` se vazio). */
  currentLabelId: string | null;
}

export interface StatusAdvance {
  columnKey: string;
  labelId: string;
}

/**
 * Escolhe, entre as colunas de status do board, o rótulo "concluído" para auto-avançar o status de um
 * item ao detectar um PR mergeado (ADR 0056) — heurística DELIBERADAMENTE CONSERVADORA:
 *
 * 1. Ignora colunas de status que são, na prática, um alternador binário (ex.: "OS solicitada: Sim/
 *    Não") — têm só 2 categorias representadas entre os rótulos, uma delas `done`. Um board real (ex.:
 *    seed PMSP) pode ter VÁRIAS colunas do tipo `status` com um rótulo "Sim" de categoria `done`, e
 *    nenhuma delas é "o" status do item — só a coluna de workflow de verdade (≥ 3 categorias
 *    representadas, cobrindo não-iniciado/em andamento/concluído e opcionalmente travado) conta.
 * 2. Entre as colunas restantes, avança só quando a coluna tem EXATAMENTE UM rótulo que parece
 *    significar "concluído" (categoria `done` primeiro — o sinal estruturado que o próprio board já usa
 *    para métricas de portfólio/RAG — e, na falta dela, o nome do rótulo batendo com
 *    `isDoneLikeStatusLabel`). Mais de um candidato na mesma coluna é ambíguo e NUNCA avança (evita
 *    adivinhar errado e corromper um status não relacionado); um item que já está no rótulo escolhido
 *    também não gera avanço (nada muda). Com várias colunas elegíveis, usa a primeira encontrada.
 */
export function pickStatusAdvance(
  columns: readonly StatusColumnCandidate[],
): StatusAdvance | null {
  for (const column of columns) {
    const distinctCategories = new Set(column.labels.map((label) => label.category));
    if (distinctCategories.size < 3) continue;
    const byCategory = column.labels.filter((label) => label.category === 'done');
    const candidates = byCategory.length > 0 ? byCategory : column.labels.filter((label) => isDoneLikeStatusLabel(label.label));
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    if (target === undefined || target.id === column.currentLabelId) continue;
    return { columnKey: column.columnKey, labelId: target.id };
  }
  return null;
}
