'use client';

import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { minutesToHours, useTimeEntriesOfItem } from './model';

/** Resumo compacto de horas apontadas no item (painel do item) — ADR 0052. */
export function ItemTimeSummary({ itemId }: { itemId: string }) {
  const t = useTranslations('timesheet');
  const entries = useTimeEntriesOfItem(itemId);
  if (entries.data === undefined || entries.data.length === 0) return null;
  const totalMinutes = entries.data.reduce((sum, entry) => sum + entry.minutes, 0);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-fg-muted"
      title={t('itemSummary.label')}
    >
      <Clock className="size-3.5" aria-hidden="true" />
      {t('itemSummary.total', { hours: minutesToHours(totalMinutes) })}
    </span>
  );
}
