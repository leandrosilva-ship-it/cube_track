'use client';

import { shiftDays } from '@cube-track/shared';
import { Button, Chart, DatePicker, Field, IconButton, Input, Select, Skeleton, toast } from '@cube-track/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useMembers } from '../shell/hooks';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useWhatIf } from './hooks';
import { formatHours } from './model';

interface Draft {
  startDate: string;
  endDate: string;
  hoursPerDay: string;
}

/**
 * Simulação what-if (ADR 0052): compara a capacidade real de uma pessoa com um cenário hipotético de
 * alocações, sem persistir nada — chama só `POST /v1/capacity/what-if`, nunca `create`/`update`.
 */
export function WhatIfPanel() {
  const t = useTranslations('capacity');
  const errorMessage = useErrorMessage();
  const members = useMembers();
  const whatIf = useWhatIf();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [userId, setUserId] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([
    { startDate: today, endDate: shiftDays(today, 6), hoursPerDay: '4' },
  ]);

  const addDraft = () => {
    setDrafts((prev) => [...prev, { startDate: today, endDate: shiftDays(today, 6), hoursPerDay: '4' }]);
  };
  const removeDraft = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };
  const updateDraft = (index: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const run = async () => {
    if (userId === '') return;
    try {
      await whatIf.mutateAsync({
        userId,
        from: today,
        to: shiftDays(today, 83),
        hypotheticalAllocations: drafts,
      });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const result = whatIf.data;

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('whatIf.person')}>
        <Select
          value={userId}
          onValueChange={setUserId}
          options={(members.data ?? []).map((member) => ({ value: member.userId, label: member.name }))}
          placeholder={t('whatIf.person')}
        />
      </Field>
      <div className="flex flex-col gap-2">
        {drafts.map((draft, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
            <Field label={t('whatIf.start')}>
              <DatePicker
                value={draft.startDate}
                onChange={(value) => {
                  if (value !== null) updateDraft(index, { startDate: value });
                }}
                label={t('whatIf.start')}
                placeholder={t('whatIf.start')}
                clearLabel={t('absences.clear')}
              />
            </Field>
            <Field label={t('whatIf.end')}>
              <DatePicker
                value={draft.endDate}
                onChange={(value) => {
                  if (value !== null) updateDraft(index, { endDate: value });
                }}
                label={t('whatIf.end')}
                placeholder={t('whatIf.end')}
                clearLabel={t('absences.clear')}
              />
            </Field>
            <Field label={t('whatIf.hoursPerDay')}>
              <Input
                type="number"
                min={0}
                max={24}
                value={draft.hoursPerDay}
                onChange={(event) => {
                  updateDraft(index, { hoursPerDay: event.target.value });
                }}
                className="w-20"
              />
            </Field>
            <IconButton
              label={t('whatIf.removeRow')}
              icon={<Trash2 aria-hidden="true" />}
              size="icon-sm"
              onClick={() => {
                removeDraft(index);
              }}
            />
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={addDraft} className="self-start">
          <Plus aria-hidden="true" />
          {t('whatIf.addRow')}
        </Button>
      </div>
      <Button onClick={() => void run()} loading={whatIf.isPending} disabled={userId === ''}>
        {t('whatIf.run')}
      </Button>
      {whatIf.isPending ? <Skeleton className="h-48" /> : null}
      {result !== undefined ? (
        <Chart
          ariaLabel={t('whatIf.title')}
          option={{
            legend: { data: [t('whatIf.real'), t('whatIf.simulated')] },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: result.real.map((bucket) => bucket.bucket) },
            yAxis: { type: 'value' },
            series: [
              {
                name: t('whatIf.real'),
                type: 'bar',
                data: result.real.map((bucket) => bucket.allocatedHours),
              },
              {
                name: t('whatIf.simulated'),
                type: 'bar',
                data: result.simulated.map((bucket) => bucket.allocatedHours),
              },
            ],
          }}
        />
      ) : null}
      {result?.simulated.some((bucket) => bucket.overallocated) === true ? (
        <p className="text-sm text-danger">{t('whatIf.wouldOverallocate')}</p>
      ) : null}
      {result !== undefined ? (
        <p className="text-xs text-fg-muted">
          {t('whatIf.peak', { hours: formatHours(Math.max(...result.simulated.map((bucket) => bucket.allocatedHours), 0)) })}
        </p>
      ) : null}
    </div>
  );
}
