'use client';

import { Badge, Button, DatePicker, Field, Select, Skeleton, toast } from '@cube-track/ui';
import { CalendarOff, Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMe } from '../shell/hooks';
import type { Absence, AbsenceStatus } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useAbsencesOfUser,
  useDecideAbsence,
  useDeleteAbsence,
  usePendingAbsences,
  useRequestAbsence,
} from './hooks';
import { ABSENCE_TYPES } from './model';

const STATUS_TONE: Record<AbsenceStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
};

function RequestForm({ userId }: { userId: string }) {
  const t = useTranslations('capacity');
  const errorMessage = useErrorMessage();
  const request = useRequestAbsence(userId);
  const [type, setType] = useState<(typeof ABSENCE_TYPES)[number]>('vacation');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const submit = async () => {
    if (startDate === null || endDate === null) return;
    try {
      await request.mutateAsync({ type, startDate, endDate });
      toast.success(t('absences.requested'));
      setStartDate(null);
      setEndDate(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4"
    >
      <Field label={t('absences.type')}>
        <Select
          value={type}
          onValueChange={(value) => {
            setType(value as (typeof ABSENCE_TYPES)[number]);
          }}
          options={ABSENCE_TYPES.map((entry) => ({ value: entry, label: t(`absences.types.${entry}`) }))}
        />
      </Field>
      <Field label={t('absences.start')}>
        <DatePicker
          value={startDate}
          onChange={setStartDate}
          label={t('absences.start')}
          placeholder={t('absences.start')}
          clearLabel={t('absences.clear')}
        />
      </Field>
      <Field label={t('absences.end')}>
        <DatePicker
          value={endDate}
          onChange={setEndDate}
          label={t('absences.end')}
          placeholder={t('absences.end')}
          clearLabel={t('absences.clear')}
        />
      </Field>
      <Button type="submit" loading={request.isPending} disabled={startDate === null || endDate === null}>
        {t('absences.request')}
      </Button>
    </form>
  );
}

function MyAbsences({ userId }: { userId: string }) {
  const t = useTranslations('capacity');
  const absences = useAbsencesOfUser(userId);
  const remove = useDeleteAbsence();

  if (absences.data === undefined) return <Skeleton className="h-24" />;
  if (absences.data.length === 0)
    return <p className="text-sm text-fg-muted">{t('absences.empty')}</p>;

  return (
    <ul className="flex flex-col gap-2">
      {absences.data.map((absence) => (
        <li key={absence.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <span>
            {t(`absences.types.${absence.type}`)} — {absence.startDate} → {absence.endDate}
          </span>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[absence.status]}>{t(`absences.status.${absence.status}`)}</Badge>
            {absence.status === 'draft' || absence.status === 'submitted' ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  remove.mutate({ id: absence.id, userId });
                }}
              >
                {t('absences.cancel')}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PendingApprovals() {
  const t = useTranslations('capacity');
  const pending = usePendingAbsences();
  const decide = useDecideAbsence();

  if (pending.data === undefined) return <Skeleton className="h-24" />;
  if (pending.data.length === 0) return <p className="text-sm text-fg-muted">{t('absences.noPending')}</p>;

  return (
    <ul className="flex flex-col gap-2">
      {pending.data.map((absence: Absence) => (
        <li key={absence.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
          <span>
            {t(`absences.types.${absence.type}`)} — {absence.startDate} → {absence.endDate}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                decide.mutate({ id: absence.id, status: 'approved', userId: absence.userId });
              }}
            >
              <Check aria-hidden="true" />
              {t('absences.approve')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                decide.mutate({ id: absence.id, status: 'rejected', userId: absence.userId });
              }}
            >
              <X aria-hidden="true" />
              {t('absences.reject')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Ausências próprias (solicitar/cancelar) e fila de aprovação de quem gerencia recursos (ADR 0052). */
export function AbsencesPanel({ canApprove }: { canApprove: boolean }) {
  const t = useTranslations('capacity');
  const me = useMe();
  if (me.data === undefined) return <Skeleton className="h-48" />;
  const userId = me.data.user.id;

  return (
    <div className="flex flex-col gap-4">
      <RequestForm userId={userId} />
      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('absences.mine')}</h3>
        <MyAbsences userId={userId} />
      </section>
      {canApprove ? (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CalendarOff className="size-4" aria-hidden="true" />
            {t('absences.pendingTitle')}
          </h3>
          <PendingApprovals />
        </section>
      ) : null}
    </div>
  );
}
