'use client';

import { formatDate } from '@cube-track/i18n';
import { Badge, Button, EmptyState, Field, Skeleton, Textarea, toast } from '@cube-track/ui';
import { ClipboardCheck, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useMembers } from '../shell/hooks';

import { minutesToHours, useDecideTimesheetApproval, usePendingTimesheetApprovals } from './model';

/** Fila de aprovação semanal (gestores com `timesheet.approve`): aprovar/recusar com comentário. */
export function TimesheetApprovalQueue() {
  const t = useTranslations('timesheet');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const pending = usePendingTimesheetApprovals();
  const members = useMembers();
  const decide = useDecideTimesheetApproval();
  const [comments, setComments] = useState<Record<string, string>>({});

  if (pending.isLoading) return <Skeleton className="h-48" />;

  if (pending.isError) {
    if (isApiError(pending.error, 403))
      return <EmptyState icon={<Lock aria-hidden="true" />} title={t('queue.forbidden')} />;
    return <EmptyState icon={<Lock aria-hidden="true" />} title={errorMessage(pending.error)} />;
  }

  const rows = pending.data ?? [];
  if (rows.length === 0)
    return <EmptyState icon={<ClipboardCheck aria-hidden="true" />} title={t('queue.empty')} />;

  const nameOf = (userId: string) =>
    members.data?.find((member) => member.userId === userId)?.name ?? userId;

  const decideOn = async (id: string, status: 'approved' | 'rejected') => {
    const trimmed = comments[id]?.trim();
    try {
      await decide.mutateAsync({ id, status, comment: trimmed === undefined || trimmed === '' ? null : trimmed });
      toast.success(status === 'approved' ? t('queue.approved') : t('queue.rejected'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((approval) => (
        <li key={approval.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{nameOf(approval.userId)}</p>
              <p className="text-xs text-fg-muted">
                {t('queue.period', {
                  from: formatDate(approval.periodStart, locale, { style: 'dayMonth' }),
                  to: formatDate(approval.periodEnd, locale, { style: 'dayMonth' }),
                })}
              </p>
            </div>
            <Badge tone="info">{t('queue.hours', { hours: minutesToHours(approval.totalMinutes) })}</Badge>
          </div>
          <Field label={t('queue.comment')}>
            <Textarea
              rows={2}
              value={comments[approval.id] ?? ''}
              onChange={(event) => {
                setComments((current) => ({ ...current, [approval.id]: event.target.value }));
              }}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              variant="danger"
              loading={decide.isPending}
              onClick={() => {
                void decideOn(approval.id, 'rejected');
              }}
            >
              {t('queue.reject')}
            </Button>
            <Button
              loading={decide.isPending}
              onClick={() => {
                void decideOn(approval.id, 'approved');
              }}
            >
              {t('queue.approve')}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
