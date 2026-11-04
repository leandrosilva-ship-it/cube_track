'use client';

import { Badge, EmptyState, Skeleton } from '@cube-track/ui';
import { formatDate } from '@cube-track/i18n';
import { Sparkles } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { delayRiskTone, similarityPercent } from './model';
import { usePredictions } from './hooks';

/** Aba "Previsões" do diálogo de IA (ADR 0055): risco de atraso e duplicados são cálculos
 * determinísticos; só a narrativa final é gerada por IA (ver `AiPredictionsService`). */
export function PredictionsPanel({ boardId }: { boardId: string }) {
  const t = useTranslations('ai.predictions');
  const locale = useLocale();
  const predictions = usePredictions(boardId, true);

  if (predictions.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (predictions.data === undefined) {
    return <EmptyState icon={<Sparkles aria-hidden="true" />} title={t('loading')} />;
  }

  const { narrative, delayRisk, assigneeSuggestions, duplicates } = predictions.data;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-fg-muted">{t('description')}</p>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-fg-subtle">{t('narrativeTitle')}</h3>
        <p className="whitespace-pre-wrap text-sm text-fg">{narrative}</p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-fg-subtle">{t('delayRiskTitle')}</h3>
        {delayRisk.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('delayRiskEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {delayRisk.map((entry) => (
              <li key={entry.itemId} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-sm text-fg">{entry.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-fg-subtle">{formatDate(entry.dueDate, locale)}</span>
                  <Badge tone={delayRiskTone(entry.status)}>
                    {entry.status === 'overdue' ? t('statusOverdue') : t('statusDueSoon')}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-fg-subtle">{t('assigneeSuggestionsTitle')}</h3>
        {assigneeSuggestions.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('assigneeSuggestionsEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {assigneeSuggestions.map((entry) => (
              <li key={entry.itemId} className="flex flex-col gap-0.5 py-2">
                <span className="text-sm text-fg">
                  {entry.name} → <span className="font-medium">{entry.suggestedUserName}</span>
                </span>
                <span className="text-xs text-fg-subtle">{entry.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase text-fg-subtle">{t('duplicatesTitle')}</h3>
        {duplicates.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('duplicatesEmpty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {duplicates.map((entry) => (
              <li
                key={`${entry.itemIdA}:${entry.itemIdB}`}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 truncate text-sm text-fg">
                  {entry.nameA} / {entry.nameB}
                </span>
                <Badge tone="info">{t('similarity', { percent: similarityPercent(entry.similarity) })}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
