'use client';

import { formatRelativeTime } from '@cube-track/i18n';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Select,
  Skeleton,
  Textarea,
} from '@cube-track/ui';
import { Check, ShieldCheck, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ApprovalRequest, Item } from '@/lib/api/types';

import { useMembers } from '../shell/hooks';
import { useApprovalActions, useApprovals } from './hooks';

const STATUS_TONE: Record<ApprovalRequest['status'], 'neutral' | 'success' | 'danger' | 'warning'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** Aba "Aprovações": pedir aprovação a um ou mais aprovadores (todos/qualquer um) e ver o histórico. */
export function ApprovalsTab({
  item,
  canRequest,
}: {
  item: Item;
  canRequest: boolean;
}) {
  const t = useTranslations('itemPanel');
  const approvals = useApprovals(item.id);
  const actions = useApprovalActions(item.id);
  const members = useMembers();
  const [requesting, setRequesting] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {approvals.isPending ? (
        <Skeleton className="h-16" />
      ) : (approvals.data ?? []).length === 0 && !requesting ? (
        <EmptyState icon={<ShieldCheck aria-hidden="true" />} title={t('approvals.empty')} />
      ) : (
        <ul className="flex flex-col gap-3">
          {(approvals.data ?? []).map((request) => (
            <ApprovalCard key={request.id} request={request} canCancel={canRequest} actions={actions} />
          ))}
        </ul>
      )}
      {canRequest ? (
        requesting ? (
          <RequestForm
            candidates={(members.data ?? []).filter((member) => member.status === 'active')}
            onCancel={() => {
              setRequesting(false);
            }}
            onSubmit={async (input) => {
              const ok = await actions.request(input);
              if (ok) setRequesting(false);
            }}
          />
        ) : (
          <Button
            size="sm"
            variant="subtle"
            onClick={() => {
              setRequesting(true);
            }}
          >
            {t('approvals.request')}
          </Button>
        )
      ) : null}
    </div>
  );
}

function ApprovalCard({
  request,
  canCancel,
  actions,
}: {
  request: ApprovalRequest;
  canCancel: boolean;
  actions: ReturnType<typeof useApprovalActions>;
}) {
  const t = useTranslations('itemPanel');
  const locale = useLocale();
  const [comment, setComment] = useState('');

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[request.status]}>{t(`approvals.status.${request.status}`)}</Badge>
        <span className="text-xs text-fg-subtle">{t(`approvals.mode.${request.mode}`)}</span>
        <span className="text-xs text-fg-subtle">
          {t('approvals.requestedBy', { name: request.requestedByName ?? t('system') })} ·{' '}
          {formatRelativeTime(request.createdAt, locale)}
        </span>
        {request.status === 'pending' && canCancel ? (
          <Button
            variant="ghost"
            size="sm"
            className="ms-auto"
            onClick={() => {
              void actions.cancel(request.id);
            }}
          >
            {t('approvals.cancel')}
          </Button>
        ) : null}
      </div>
      {request.note !== null && request.note !== '' ? <p className="mt-2 text-sm">{request.note}</p> : null}
      <ul className="mt-3 flex flex-col gap-2">
        {request.approvers.map((approver) => (
          <li key={approver.userId} className="flex items-start gap-2">
            <Avatar person={{ id: approver.userId, name: approver.name, avatarUrl: approver.avatarUrl }} size="xs" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="font-medium">{approver.name}</span>
                {approver.decision === 'approved' ? (
                  <Check className="size-3.5 text-success" aria-hidden="true" />
                ) : approver.decision === 'rejected' ? (
                  <X className="size-3.5 text-danger" aria-hidden="true" />
                ) : (
                  <span className="text-xs text-fg-subtle">{t('approvals.pending')}</span>
                )}
              </div>
              {approver.comment !== null && approver.comment !== '' ? (
                <p className="text-xs text-fg-muted">{approver.comment}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {request.canDecide ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <Textarea
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
            }}
            placeholder={t('approvals.commentPlaceholder')}
            rows={2}
            aria-label={t('approvals.commentPlaceholder')}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                void actions.decide(request.id, 'rejected', comment.trim() || undefined);
              }}
            >
              {t('approvals.reject')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                void actions.decide(request.id, 'approved', comment.trim() || undefined);
              }}
            >
              {t('approvals.approve')}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RequestForm({
  candidates,
  onCancel,
  onSubmit,
}: {
  candidates: { userId: string; name: string; avatarUrl: string | null }[];
  onCancel: () => void;
  onSubmit: (input: { approverIds: string[]; mode: 'all' | 'any'; note?: string }) => Promise<void>;
}) {
  const t = useTranslations('itemPanel');
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<'all' | 'any'>('any');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <p className="text-xs font-semibold uppercase text-fg-subtle">{t('approvals.chooseApprovers')}</p>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {candidates.map((candidate) => (
          <li key={candidate.userId}>
            <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-hover">
              <Checkbox
                checked={selected.includes(candidate.userId)}
                onCheckedChange={(checked) => {
                  setSelected((current) =>
                    checked === true
                      ? [...current, candidate.userId]
                      : current.filter((id) => id !== candidate.userId),
                  );
                }}
              />
              <Avatar person={{ id: candidate.userId, name: candidate.name, avatarUrl: candidate.avatarUrl }} size="xs" decorative />
              {candidate.name}
            </label>
          </li>
        ))}
      </ul>
      <Select
        aria-label={t('approvals.mode.label')}
        value={mode}
        onValueChange={(value) => {
          setMode(value as 'all' | 'any');
        }}
        options={[
          { value: 'any', label: t('approvals.mode.any') },
          { value: 'all', label: t('approvals.mode.all') },
        ]}
      />
      <Textarea
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
        placeholder={t('approvals.notePlaceholder')}
        rows={2}
        aria-label={t('approvals.notePlaceholder')}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          size="sm"
          disabled={selected.length === 0 || sending}
          onClick={() => {
            setSending(true);
            void onSubmit({ approverIds: selected, mode, ...(note.trim() === '' ? {} : { note: note.trim() }) }).finally(() => {
              setSending(false);
            });
          }}
        >
          {t('approvals.send')}
        </Button>
      </div>
    </div>
  );
}
