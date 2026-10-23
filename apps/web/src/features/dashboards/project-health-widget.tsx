'use client';

import { Button } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import type { HealthStatus, WidgetData } from '@/lib/api/types';

export const HEALTH_COLORS: Record<HealthStatus, string> = {
  green: '#00c875',
  yellow: '#ffcb00',
  red: '#df2f4a',
  grey: '#c4c4c4',
};

const DIMENSIONS = ['overall', 'schedule', 'cost', 'scope', 'quality', 'risk'] as const;

export interface ProjectHealthWidgetBodyProps {
  data: Extract<WidgetData, { kind: 'project_health' }>;
  onReport?: () => void;
}

/** Corpo do widget `project_health`: último relato (6 dimensões + percentual/SPI/CPI) (ADR 0050). */
export function ProjectHealthWidgetBody({ data, onReport }: ProjectHealthWidgetBodyProps) {
  const t = useTranslations('dashboards');
  if (data.latest === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-xs text-fg-subtle">{t('projectHealth.empty')}</p>
        {onReport !== undefined ? (
          <Button size="sm" variant="secondary" onClick={onReport}>
            {t('projectHealth.report')}
          </Button>
        ) : null}
      </div>
    );
  }
  const latest = data.latest;
  return (
    <div className="flex h-full flex-col justify-center gap-3 overflow-y-auto">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {DIMENSIONS.map((dimension) => (
          <div key={dimension} className="flex flex-col items-center gap-1">
            <span
              className="size-5 rounded-full border border-border-strong"
              style={{ backgroundColor: HEALTH_COLORS[latest[dimension]] }}
              aria-hidden="true"
            />
            <span className="text-[11px] text-fg-muted">{t(`projectHealth.dimension.${dimension}`)}</span>
          </div>
        ))}
      </div>
      {latest.percentComplete !== null || latest.spi !== null || latest.cpi !== null ? (
        <dl className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {latest.percentComplete !== null ? (
            <div className="flex gap-1">
              <dt className="text-fg-muted">{t('projectHealth.percentComplete')}</dt>
              <dd className="font-medium tabular-nums">{latest.percentComplete}%</dd>
            </div>
          ) : null}
          {latest.spi !== null ? (
            <div className="flex gap-1">
              <dt className="text-fg-muted">SPI</dt>
              <dd className="font-medium tabular-nums">{latest.spi}</dd>
            </div>
          ) : null}
          {latest.cpi !== null ? (
            <div className="flex gap-1">
              <dt className="text-fg-muted">CPI</dt>
              <dd className="font-medium tabular-nums">{latest.cpi}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {latest.summary !== null ? (
        <p className="line-clamp-2 text-center text-xs text-fg-muted">{latest.summary}</p>
      ) : null}
      <p className="text-center text-[11px] text-fg-subtle">
        {t('projectHealth.reportedAt', { date: new Date(latest.reportedAt).toLocaleDateString('pt-BR') })}
      </p>
      {onReport !== undefined ? (
        <Button size="sm" variant="secondary" className="self-center" onClick={onReport}>
          {t('projectHealth.report')}
        </Button>
      ) : null}
    </div>
  );
}
