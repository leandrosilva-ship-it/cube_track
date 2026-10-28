'use client';

import { Chart, Select, Skeleton } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useCapacityForecast } from './hooks';

/** Previsão de demanda × capacidade para 3/6/12 meses (ADR 0052). */
export function ForecastPanel() {
  const t = useTranslations('capacity');
  const [months, setMonths] = useState<3 | 6 | 12>(3);
  const forecast = useCapacityForecast(months);

  if (forecast.data === undefined) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-3">
      <Select
        aria-label={t('forecast.horizon')}
        value={String(months)}
        onValueChange={(value) => {
          setMonths(Number(value) as 3 | 6 | 12);
        }}
        options={[
          { value: '3', label: t('forecast.months', { count: 3 }) },
          { value: '6', label: t('forecast.months', { count: 6 }) },
          { value: '12', label: t('forecast.months', { count: 12 }) },
        ]}
      />
      <Chart
        ariaLabel={t('forecast.title')}
        option={{
          legend: { data: [t('forecast.capacity'), t('forecast.demand')] },
          tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: forecast.data.map((bucket) => bucket.month) },
          yAxis: { type: 'value' },
          series: [
            {
              name: t('forecast.capacity'),
              type: 'bar',
              data: forecast.data.map((bucket) => bucket.capacityHours),
            },
            {
              name: t('forecast.demand'),
              type: 'bar',
              data: forecast.data.map((bucket) => bucket.demandHours),
            },
          ],
        }}
      />
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {forecast.data.map((bucket) => (
          <li key={bucket.month} className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">{bucket.month}</p>
            <p className={bucket.gapHours < 0 ? 'text-danger' : 'text-success'}>
              {t('forecast.gap', { hours: Math.abs(Math.round(bucket.gapHours)) })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
