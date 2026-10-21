/**
 * Resolução pura do estado de um pedido de aprovação (ADR 0048).
 *
 * - `all`: qualquer rejeição resolve `rejected` de imediato; só vira `approved` quando todos
 *   os aprovadores aprovaram.
 * - `any`: a primeira aprovação já resolve `approved`; só vira `rejected` quando todos os
 *   aprovadores rejeitaram.
 * - Enquanto nenhuma das condições acima vale, o pedido continua `pending`.
 */
export type ApprovalDecision = 'approved' | 'rejected' | null;
export type ApprovalMode = 'all' | 'any';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export function resolveApprovalStatus(
  mode: ApprovalMode,
  decisions: readonly ApprovalDecision[],
): ApprovalStatus {
  if (decisions.length === 0) return 'pending';
  const approved = decisions.filter((decision) => decision === 'approved').length;
  const rejected = decisions.filter((decision) => decision === 'rejected').length;
  const allDecided = decisions.every((decision) => decision !== null);
  if (mode === 'all') {
    if (rejected > 0) return 'rejected';
    if (approved === decisions.length) return 'approved';
    return 'pending';
  }
  if (approved > 0) return 'approved';
  if (allDecided && rejected === decisions.length) return 'rejected';
  return 'pending';
}
