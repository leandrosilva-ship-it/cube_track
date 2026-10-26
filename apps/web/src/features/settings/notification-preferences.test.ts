import { describe, expect, it } from 'vitest';

import type { NotificationPreference } from '@/lib/api/types';

import { findEmailPreference, resolveUiFrequency, toUpdateEntry } from './notification-preferences';

function pref(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    id: 'p1',
    channel: 'email',
    eventType: 'mention',
    enabled: true,
    frequency: 'instant',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('resolveUiFrequency', () => {
  it('sem preferência salva, o padrão é instantâneo', () => {
    expect(resolveUiFrequency(undefined)).toBe('instant');
  });

  it('enabled:false sempre resolve para "off", qualquer que seja frequency', () => {
    expect(resolveUiFrequency(pref({ enabled: false, frequency: 'hourly' }))).toBe('off');
  });

  it('frequency:"never" resolve para "off" mesmo com enabled:true', () => {
    expect(resolveUiFrequency(pref({ enabled: true, frequency: 'never' }))).toBe('off');
  });

  it('repassa a frequência quando habilitado e diferente de never', () => {
    expect(resolveUiFrequency(pref({ enabled: true, frequency: 'daily' }))).toBe('daily');
  });
});

describe('findEmailPreference', () => {
  it('encontra a linha do canal email e eventType pedidos, ignorando outros canais', () => {
    const rows = [
      pref({ eventType: 'mention', channel: 'in_app' }),
      pref({ eventType: 'mention' }),
    ];
    expect(findEmailPreference(rows, 'mention')?.channel).toBe('email');
  });

  it('retorna undefined quando não há linha correspondente', () => {
    expect(findEmailPreference([], 'sla')).toBeUndefined();
  });
});

describe('toUpdateEntry', () => {
  it('"off" vira enabled:false e frequency:never', () => {
    expect(toUpdateEntry('approval', 'off')).toEqual({
      channel: 'email',
      eventType: 'approval',
      enabled: false,
      frequency: 'never',
    });
  });

  it('demais valores viram enabled:true com a própria frequência', () => {
    expect(toUpdateEntry('sla', 'hourly')).toEqual({
      channel: 'email',
      eventType: 'sla',
      enabled: true,
      frequency: 'hourly',
    });
  });
});
