'use client';

import { Field, Select, Skeleton, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import { useNotificationPreferences, useUpdateNotificationPreferences } from './hooks';
import {
  findEmailPreference,
  resolveUiFrequency,
  toUpdateEntry,
  NOTIFICATION_EVENT_TYPES,
  UI_FREQUENCIES,
  type UiFrequency,
} from './notification-preferences';

export function NotificationPreferencesSection() {
  const t = useTranslations('settings.notificationsPrefs');
  const preferences = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  if (preferences.data === undefined) return <Skeleton className="h-48" />;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t('emailOnly')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {NOTIFICATION_EVENT_TYPES.map((eventType) => {
          const current = resolveUiFrequency(findEmailPreference(preferences.data, eventType));
          return (
            <Field
              key={eventType}
              label={t(`eventType.${eventType === '*' ? 'other' : eventType}`)}
            >
              <Select
                value={current}
                options={UI_FREQUENCIES.map((value) => ({ value, label: t(`frequency.${value}`) }))}
                onValueChange={(value) => {
                  update.mutate([toUpdateEntry(eventType, value as UiFrequency)], {
                    onSuccess: () => {
                      toast.success(t('saved'));
                    },
                  });
                }}
              />
            </Field>
          );
        })}
      </div>
    </div>
  );
}
