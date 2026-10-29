'use client';

import { StatusPill } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import type { RollupResult } from '@/lib/api/types';

import { HEALTH_COLORS } from '../dashboards/project-health-widget';

export interface RollupCardProps {
  rollup: RollupResult;
  compact?: boolean;
}

/**
 * Resumo de rollup (ADR 0053): reaproveitado pela hierarquia de portfólio, pela página de status
 * report e pelo widget de dashboard `portfolio_rollup` — uma única renderização para o mesmo dado.
 */
export function RollupCard({ rollup, compact = false }: RollupCardProps) {
  const t = useTranslations('portfolio');
  const td = useTranslations('dashboards');
  return (
    <dl className={compact ? 'grid grid-cols-2 gap-2 text-xs sm:grid-cols-4' : 'grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'}>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.overall')}</dt>
        <dd>
          <StatusPill
            label={td(`projectHealth.status.${rollup.overall}`)}
            color={HEALTH_COLORS[rollup.overall]}
          />
        </dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.percentComplete')}</dt>
        <dd className="font-medium tabular-nums">{rollup.percentComplete.toFixed(1)}%</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.plannedCost')}</dt>
        <dd className="font-medium tabular-nums">{rollup.plannedCost.toLocaleString('pt-BR')}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.actualCost')}</dt>
        <dd className="font-medium tabular-nums">{rollup.actualCost.toLocaleString('pt-BR')}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.forecastCost')}</dt>
        <dd className="font-medium tabular-nums">{rollup.forecastCost.toLocaleString('pt-BR')}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.openRisks')}</dt>
        <dd className="font-medium tabular-nums">{rollup.openRisks}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.criticalRisks')}</dt>
        <dd className="font-medium tabular-nums text-danger">{rollup.criticalRisks}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-fg-muted">{t('rollup.boards', { count: rollup.boardCount })}</dt>
        <dd className="font-medium tabular-nums">{rollup.boardCount}</dd>
      </div>
    </dl>
  );
}
