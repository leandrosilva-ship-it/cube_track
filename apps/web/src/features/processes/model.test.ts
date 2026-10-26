import { describe, expect, it } from 'vitest';

import type { Phase, ProcessConfig, SlaTracker, TransitionRule } from '@/lib/api/types';

import {
  durationParts,
  phasesByGroupId,
  resolveTransitionRule,
  slaBadgeFor,
  trackersByItemId,
} from './model';

function phase(overrides: Partial<Phase>): Phase {
  return {
    id: 'phase-1',
    pipeId: 'pipe-1',
    groupId: 'group-1',
    name: 'Fase',
    description: null,
    kind: 'intermediate',
    requiredColumnKeys: [],
    formId: null,
    wipLimit: null,
    position: 'a0',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function rule(overrides: Partial<TransitionRule>): TransitionRule {
  return {
    id: 'rule-1',
    pipeId: 'pipe-1',
    fromPhaseId: null,
    toPhaseId: 'phase-2',
    conditions: null,
    requiredColumnKeys: [],
    allowedRoleIds: [],
    requiresApproval: false,
    isEnabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function tracker(overrides: Partial<SlaTracker>): SlaTracker {
  return {
    id: 'tracker-1',
    slaId: 'sla-1',
    itemId: 'item-1',
    status: 'running',
    startedAt: '2026-03-01T00:00:00Z',
    dueAt: '2026-03-01T08:00:00Z',
    warningAt: '2026-03-01T06:24:00Z',
    ...overrides,
  };
}

describe('phasesByGroupId', () => {
  it('indexa as fases pelo id do grupo; null devolve mapa vazio', () => {
    const config: ProcessConfig = {
      pipe: null,
      phases: [phase({ id: 'p1', groupId: 'g1' }), phase({ id: 'p2', groupId: 'g2' })],
      transitionRules: [],
    };
    const map = phasesByGroupId(config);
    expect(map.get('g1')?.id).toBe('p1');
    expect(map.get('g2')?.id).toBe('p2');
    expect(phasesByGroupId(null).size).toBe(0);
  });
});

describe('resolveTransitionRule', () => {
  it('prioriza a regra específica sobre a curinga; ignora regras desabilitadas', () => {
    const specific = rule({ id: 'specific', fromPhaseId: 'a', toPhaseId: 'b' });
    const wildcard = rule({ id: 'wildcard', fromPhaseId: null, toPhaseId: 'b' });
    expect(resolveTransitionRule([wildcard, specific], 'a', 'b')?.id).toBe('specific');
    expect(resolveTransitionRule([wildcard], 'a', 'b')?.id).toBe('wildcard');
    expect(resolveTransitionRule([wildcard], 'other', 'b')?.id).toBe('wildcard');
    expect(resolveTransitionRule([], 'a', 'b')).toBeUndefined();
    const disabled = rule({ id: 'disabled', fromPhaseId: 'a', toPhaseId: 'b', isEnabled: false });
    expect(resolveTransitionRule([disabled], 'a', 'b')).toBeUndefined();
  });
});

describe('durationParts', () => {
  it('escolhe a maior unidade "redonda"', () => {
    expect(durationParts(30)).toEqual({ value: 30, unit: 'minutes' });
    expect(durationParts(120)).toEqual({ value: 2, unit: 'hours' });
    expect(durationParts(60 * 48)).toEqual({ value: 2, unit: 'days' });
  });
});

describe('slaBadgeFor', () => {
  it('sem indicador quando cumprido ou encerrado', () => {
    expect(slaBadgeFor(tracker({ status: 'met' }), new Date('2026-03-01T01:00:00Z'))).toBeNull();
    expect(slaBadgeFor(tracker({ status: 'stopped' }), new Date('2026-03-01T01:00:00Z'))).toBeNull();
  });

  it('`breached` quando o status já é violado ou quando passou do prazo', () => {
    const badge = slaBadgeFor(tracker({ status: 'breached' }), new Date('2026-03-01T09:00:00Z'));
    expect(badge?.variant).toBe('breached');
    expect(badge?.message.key).toBe('summary.sla.overdue');

    const stillRunningButLate = slaBadgeFor(
      tracker({ status: 'running' }),
      new Date('2026-03-01T09:00:00Z'),
    );
    expect(stillRunningButLate?.variant).toBe('breached');
  });

  it('`warning` quando passou de `warningAt` mas ainda não venceu; `ok` antes disso', () => {
    const warning = slaBadgeFor(tracker({}), new Date('2026-03-01T07:00:00Z'));
    expect(warning?.variant).toBe('warning');
    const ok = slaBadgeFor(tracker({}), new Date('2026-03-01T02:00:00Z'));
    expect(ok?.variant).toBe('ok');
  });
});

describe('trackersByItemId', () => {
  it('mantém o tracker mais urgente por item (violado > em execução > o resto)', () => {
    const map = trackersByItemId([
      tracker({ id: 't1', itemId: 'i1', status: 'running', dueAt: '2026-03-02T00:00:00Z' }),
      tracker({ id: 't2', itemId: 'i1', status: 'breached', dueAt: '2026-03-01T00:00:00Z' }),
      tracker({ id: 't3', itemId: 'i2', status: 'running', dueAt: '2026-03-03T00:00:00Z' }),
    ]);
    expect(map.get('i1')?.id).toBe('t2');
    expect(map.get('i2')?.id).toBe('t3');
  });
});
