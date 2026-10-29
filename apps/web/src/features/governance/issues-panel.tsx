'use client';

import { Badge, Button, EmptyState, Field, IconButton, Input, Select, Skeleton, Textarea, toast } from '@cube-track/ui';
import { Bug, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { GovernanceIssue, IssueSeverity, IssueStatus, Risk } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateIssue, useDeleteIssue, useIssues, useUpdateIssue } from './model';

const ISSUE_SEVERITIES: IssueSeverity[] = ['low', 'medium', 'high', 'critical'];
const ISSUE_STATUSES: IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

function toneForSeverity(severity: IssueSeverity): 'success' | 'warning' | 'danger' | 'neutral' {
  if (severity === 'critical') return 'danger';
  if (severity === 'high') return 'warning';
  if (severity === 'medium') return 'neutral';
  return 'success';
}

export interface IssuesPanelProps {
  boardId: string;
  risks: Risk[];
  canManage: boolean;
}

interface IssueFormState {
  title: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  riskId: string;
  dueDate: string;
  resolution: string;
}

const EMPTY_FORM: IssueFormState = {
  title: '',
  description: '',
  severity: 'medium',
  status: 'open',
  riskId: '',
  dueDate: '',
  resolution: '',
};

export function IssuesPanel({ boardId, risks, canManage }: IssuesPanelProps) {
  const t = useTranslations('governance.issues');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const issues = useIssues(boardId);
  const createIssue = useCreateIssue(boardId);
  const updateIssue = useUpdateIssue(boardId);
  const deleteIssue = useDeleteIssue(boardId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<IssueFormState>(EMPTY_FORM);

  const severityOptions = ISSUE_SEVERITIES.map((severity) => ({
    value: severity,
    label: t(`severityLabel.${severity}`),
  }));
  const statusOptions = ISSUE_STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) }));
  const riskOptions = [
    { value: '', label: t('noLinkedRisk') },
    ...risks.map((risk) => ({ value: risk.id, label: risk.title })),
  ];

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const startEdit = (issue: GovernanceIssue) => {
    setEditingId(issue.id);
    setForm({
      title: issue.title,
      description: issue.description ?? '',
      severity: issue.severity,
      status: issue.status,
      riskId: issue.riskId ?? '',
      dueDate: issue.dueDate ?? '',
      resolution: issue.resolution ?? '',
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (form.title.trim() === '') return;
    const input = {
      title: form.title.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      severity: form.severity,
      status: form.status,
      riskId: form.riskId === '' ? null : form.riskId,
      dueDate: form.dueDate === '' ? null : form.dueDate,
      resolution: form.resolution.trim() === '' ? null : form.resolution.trim(),
    };
    try {
      if (editingId === null) {
        await createIssue.mutateAsync(input);
        toast.success(t('created'));
      } else {
        await updateIssue.mutateAsync({ id: editingId, input });
        toast.success(t('updated'));
      }
      setFormOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteIssue.mutateAsync(id);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (issues.data === undefined) return <Skeleton className="h-32" />;

  return (
    <div className="flex flex-col gap-4">
      {issues.data.length === 0 ? (
        <EmptyState icon={<Bug aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.data.map((issue) => (
            <li key={issue.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-fg">{issue.title}</p>
                  {issue.riskId !== null ? (
                    <p className="text-xs text-fg-muted">
                      {t('linkedRisk')}: {risks.find((risk) => risk.id === issue.riskId)?.title ?? issue.riskId}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={toneForSeverity(issue.severity)}>{t(`severityLabel.${issue.severity}`)}</Badge>
                  <Badge tone="neutral">{t(`status.${issue.status}`)}</Badge>
                  {canManage ? (
                    <>
                      <IconButton
                        label={t('edit')}
                        icon={<Pencil aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          startEdit(issue);
                        }}
                      />
                      <IconButton
                        label={t('delete')}
                        icon={<Trash2 aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void remove(issue.id);
                        }}
                      />
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        formOpen ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <Field label={t('title')}>
              <Input
                value={form.title}
                onChange={(event) => {
                  setForm((current) => ({ ...current, title: event.target.value }));
                }}
              />
            </Field>
            <Field label={t('description')}>
              <Textarea
                value={form.description}
                onChange={(event) => {
                  setForm((current) => ({ ...current, description: event.target.value }));
                }}
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('severity')}>
                <Select
                  value={form.severity}
                  options={severityOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, severity: value as IssueSeverity }));
                  }}
                />
              </Field>
              <Field label={t('statusField')}>
                <Select
                  value={form.status}
                  options={statusOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, status: value as IssueStatus }));
                  }}
                />
              </Field>
            </div>
            <Field label={t('linkedRisk')}>
              <Select
                value={form.riskId}
                options={riskOptions}
                onValueChange={(value) => {
                  setForm((current) => ({ ...current, riskId: value }));
                }}
              />
            </Field>
            <Field label={t('dueDate')}>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(event) => {
                  setForm((current) => ({ ...current, dueDate: event.target.value }));
                }}
              />
            </Field>
            <Field label={t('resolution')}>
              <Textarea
                value={form.resolution}
                onChange={(event) => {
                  setForm((current) => ({ ...current, resolution: event.target.value }));
                }}
                rows={2}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setFormOpen(false);
                }}
              >
                {tc('cancel')}
              </Button>
              <Button
                loading={createIssue.isPending || updateIssue.isPending}
                onClick={() => {
                  void submit();
                }}
              >
                {tc('save')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              startCreate();
            }}
          >
            <Plus aria-hidden="true" />
            {t('new')}
          </Button>
        )
      ) : null}
    </div>
  );
}
