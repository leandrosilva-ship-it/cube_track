'use client';

import { Badge } from '@cube-track/ui';
import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Contract } from '@/lib/api/types';

import { alertTone } from './model';

export interface AlertsBannerProps {
  contract: Contract;
}

/** Alertas do contrato (saldo baixo, vigência próxima do fim, OS sem emissão) — ADR 0054. */
export function AlertsBanner({ contract }: AlertsBannerProps) {
  const t = useTranslations('contracts');
  if (contract.alerts.length === 0 && contract.stalledOrders.length === 0) return null;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-3"
      role="status"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-fg">
        <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden="true" />
        {t('alerts.title')}
      </p>
      <ul className="flex flex-col gap-1.5">
        {contract.alerts.map((alert, index) => (
          <li key={`${alert.type}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={alertTone(alert.severity)}>{t(`alerts.type.${alert.type}`)}</Badge>
            <span className="text-fg-muted">{alert.message}</span>
          </li>
        ))}
        {contract.stalledOrders.map((stalled) => (
          <li key={stalled.serviceOrderId} className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={alertTone(stalled.alert.severity)}>{stalled.number}</Badge>
            <span className="text-fg-muted">{stalled.alert.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
