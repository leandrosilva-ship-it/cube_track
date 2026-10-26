import type { Phase, ProcessConfig, Sla, SlaTracker, TransitionRule } from '@/lib/api/types';

/** Chaves de `processes.summary.*` (pt-BR/en/es) usadas pelos resumos e pelo badge de SLA. */
export type ProcessSummaryKey =
  | 'summary.sla.dueIn'
  | 'summary.sla.overdue'
  | 'summary.transition.any'
  | 'summary.transition.from';

export interface I18nMessage {
  key: ProcessSummaryKey;
  values?: Record<string, string | number>;
}

export function phasesByGroupId(config: ProcessConfig | null): Map<string, Phase> {
  const map = new Map<string, Phase>();
  if (config === null) return map;
  for (const phase of config.phases) map.set(phase.groupId, phase);
  return map;
}

/**
 * Regra de transição aplicável (mesma prioridade do servidor): casamento específico por
 * `fromPhaseId` vence; sem ele, a regra curinga (`fromPhaseId: null`) se houver; senão, nenhuma.
 */
export function resolveTransitionRule(
  rules: readonly TransitionRule[],
  fromPhaseId: string | null,
  toPhaseId: string,
): TransitionRule | undefined {
  const candidates = rules.filter((rule) => rule.toPhaseId === toPhaseId && rule.isEnabled);
  return (
    candidates.find((rule) => rule.fromPhaseId === fromPhaseId) ??
    candidates.find((rule) => rule.fromPhaseId === null)
  );
}

export function phaseName(phases: readonly Phase[], id: string | null): string {
  if (id === null) return '';
  return phases.find((phase) => phase.id === id)?.name ?? id;
}

/** Resumo "de X / de qualquer fase" de uma regra de transição (resolvido via i18n pela UI). */
export function transitionFromSummary(
  rule: TransitionRule,
  phases: readonly Phase[],
): I18nMessage {
  return rule.fromPhaseId === null
    ? { key: 'summary.transition.any' }
    : { key: 'summary.transition.from', values: { phase: phaseName(phases, rule.fromPhaseId) } };
}

export type SlaBadgeVariant = 'ok' | 'warning' | 'breached';

export interface DurationParts {
  value: number;
  unit: 'minutes' | 'hours' | 'days';
}

export interface SlaBadge {
  variant: SlaBadgeVariant;
  message: I18nMessage;
}

/** Converte uma duração em minutos na maior unidade "redonda" (para exibição compacta). */
export function durationParts(totalMinutes: number): DurationParts {
  const minutes = Math.round(Math.abs(totalMinutes));
  if (minutes < 60) return { value: Math.max(minutes, 1), unit: 'minutes' };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { value: hours, unit: 'hours' };
  return { value: Math.round(hours / 24), unit: 'days' };
}

/** Formata `targetMinutes` de uma SLA para exibição na tela de configuração (ex.: "8 h"). */
export function formatTargetMinutes(totalMinutes: number): DurationParts {
  return durationParts(totalMinutes);
}

/**
 * Badge do cartão do Kanban para o tracker mais urgente de um item (`null` = sem indicador).
 * `warning` é derivado de `warningAt` (o tracker em si não grava um status "em aviso" — ver
 * `apps/worker/src/processors/sla.ts`); `breached` vence tanto pelo status quanto por `dueAt`.
 */
export function slaBadgeFor(tracker: SlaTracker, now: Date): SlaBadge | null {
  if (tracker.status === 'met' || tracker.status === 'stopped') return null;
  const dueAt = new Date(tracker.dueAt).getTime();
  const nowMs = now.getTime();
  if (tracker.status === 'breached' || nowMs > dueAt) {
    return {
      variant: 'breached',
      message: { key: 'summary.sla.overdue', values: toValues(durationParts((nowMs - dueAt) / 60_000)) },
    };
  }
  const warningAt = tracker.warningAt === null ? null : new Date(tracker.warningAt).getTime();
  const variant: SlaBadgeVariant = warningAt !== null && nowMs >= warningAt ? 'warning' : 'ok';
  return {
    variant,
    message: { key: 'summary.sla.dueIn', values: toValues(durationParts((dueAt - nowMs) / 60_000)) },
  };
}

function toValues(parts: DurationParts): Record<string, string | number> {
  return { value: parts.value, unit: parts.unit };
}

function priority(status: SlaTracker['status']): number {
  if (status === 'breached') return 2;
  if (status === 'running' || status === 'paused') return 1;
  return 0;
}

/** O tracker mais urgente por item (violado > em execução/pausado > concluído/encerrado). */
export function trackersByItemId(trackers: readonly SlaTracker[]): Map<string, SlaTracker> {
  const map = new Map<string, SlaTracker>();
  for (const tracker of trackers) {
    const current = map.get(tracker.itemId);
    if (
      current === undefined ||
      priority(tracker.status) > priority(current.status) ||
      (priority(tracker.status) === priority(current.status) &&
        new Date(tracker.dueAt).getTime() < new Date(current.dueAt).getTime())
    ) {
      map.set(tracker.itemId, tracker);
    }
  }
  return map;
}

export function slaScopeLabel(
  sla: Sla,
  phases: readonly Phase[],
  pipeName: string | undefined,
): string {
  if (sla.phaseId !== null) return phaseName(phases, sla.phaseId);
  if (sla.pipeId !== null) return pipeName ?? sla.pipeId;
  return '';
}

export interface PipeInputBody {
  name: string;
  description: string | null;
}

export interface PhaseInputBody {
  name: string;
  description: string | null;
  kind: Phase['kind'];
  requiredColumnKeys: string[];
  wipLimit: number | null;
}

export interface TransitionRuleInputBody {
  fromPhaseId: string | null;
  toPhaseId: string;
  requiredColumnKeys: string[];
  requiresApproval: boolean;
  isEnabled: boolean;
}

export interface SlaInputBody {
  name: string;
  targetMinutes: number;
  warningPercent: number;
  useBusinessTime: boolean;
  pipeId: string | null;
  phaseId: string | null;
  isEnabled: boolean;
}
