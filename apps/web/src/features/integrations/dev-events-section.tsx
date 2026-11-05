'use client';

import { formatRelativeTime } from '@cube-track/i18n';
import { Skeleton } from '@cube-track/ui';
import { GitCommitHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useDevEvents } from './hooks';

/**
 * Trilha de commits/PRs vinculados ao item (ADR 0056, somente leitura) — `GET /v1/items/:itemId/
 * dev-events`. Home natural: a aba de atividade do painel do item, já um feed agregado. Não renderiza
 * nada quando não há vínculos (board sem integração de GitHub/GitLab/Azure DevOps conectada).
 */
export function DevEventsSection({ itemId }: { itemId: string }) {
  const t = useTranslations('integrations');
  const locale = useLocale();
  const devEvents = useDevEvents(itemId);

  if (devEvents.isPending) return <Skeleton className="h-10" />;
  if (devEvents.data === undefined || devEvents.data.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <GitCommitHorizontal className="size-4 text-primary" aria-hidden="true" />
        {t('devEvents.title')}
      </h3>
      <ul className="flex flex-col gap-2">
        {devEvents.data.map((event) => (
          <li key={event.id} className="text-sm">
            <a href={event.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
              {event.title}
            </a>
            <p className="text-xs text-fg-subtle">
              {event.repo} · {event.authorName} · {formatRelativeTime(event.createdAt, locale)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
