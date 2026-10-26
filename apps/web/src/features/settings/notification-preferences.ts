import type { NotificationPreference } from '@/lib/api/types';

/**
 * Tipos de evento com preferência própria (ADR 0051). `'*'` é o padrão de todos os demais eventos.
 * Só o canal `email` tem efeito hoje — `in_app`/`push` ficam armazenados mas inertes no worker.
 */
export const NOTIFICATION_EVENT_TYPES = ['mention', 'approval', 'sla', 'automation', '*'] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** Frequência simplificada da UI: combina `enabled`+`frequency` da API num único seletor. */
export type UiFrequency = 'instant' | 'hourly' | 'daily' | 'off';
export const UI_FREQUENCIES: readonly UiFrequency[] = ['instant', 'hourly', 'daily', 'off'];

/** Sem preferência salva, o padrão efetivo é instantâneo (mesma regra aplicada pelo worker). */
export function resolveUiFrequency(preference: NotificationPreference | undefined): UiFrequency {
  if (preference === undefined) return 'instant';
  if (!preference.enabled || preference.frequency === 'never') return 'off';
  return preference.frequency;
}

export function findEmailPreference(
  preferences: readonly NotificationPreference[],
  eventType: NotificationEventType,
): NotificationPreference | undefined {
  return preferences.find((entry) => entry.channel === 'email' && entry.eventType === eventType);
}

export function toUpdateEntry(eventType: NotificationEventType, value: UiFrequency) {
  return {
    channel: 'email' as const,
    eventType,
    enabled: value !== 'off',
    frequency: value === 'off' ? ('never' as const) : value,
  };
}
