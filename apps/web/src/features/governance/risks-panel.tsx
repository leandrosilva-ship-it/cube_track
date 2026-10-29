'use client';

import { Badge, Button, EmptyState, Field, IconButton, Input, Select, Skeleton, Textarea, toast } from '@cube-track/ui';
import { AlertTriangle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Risk, RiskStatus, RiskStrategy } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateRisk, useDeleteRisk, useRisks, useUpdateRisk, type RiskInput as RiskFormInput } from './model';

const RISK_STATUSES: RiskStatus[] = ['open', 'mitigating', 'occurred', 'closed'];
const RISK_STRATEGIES: RiskStrategy[] = ['avoid', 'mitigate', 'transfer', 'accept'];
const SCALE = [1, 2, 3, 4, 5];

function toneForScore(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 15) return 'danger';
  if (score >= 8) return 'warning';
  return 'success';
}

export interface RisksPanelProps {
  boardId: string;
  canManage: boolean;
}

interface RiskFormState {
  title: string;
  description: string;
  category: string;
  probability: number;
  impact: number;
  status: RiskStatus;
  strategy: RiskStrategy | '';
  mitigationPlan: string;
  contingencyPlan: string;
  dueDate: string;
}

const EMPTY_FORM: RiskFormState = {
  title: '',
  description: '',
  category: '',
  probability: 3,
  impact: 3,
  status: 'open',
  strategy: '',
  mitigationPlan: '',
  contingencyPlan: '',
  dueDate: '',
};

export function RisksPanel({ boardId, canManage }: RisksPanelProps) {
  const t = useTranslations('governance.risks');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const risks = useRisks(boardId);
  const createRisk = useCreateRisk(boardId);
  const updateRisk = useUpdateRisk(boardId);
  const deleteRisk = useDeleteRisk(boardId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RiskFormState>(EMPTY_FORM);

  const statusOptions = RISK_STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) }));
  const strategyOptions = [
    { value: '', label: t('strategy.none') },
    ...RISK_STRATEGIES.map((strategy) => ({ value: strategy, label: t(`strategy.${strategy}`) })),
  ];
  const scaleOptions = SCALE.map((value) => ({ value: String(value), label: String(value) }));

  const startCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const startEdit = (risk: Risk) => {
    setEditingId(risk.id);
    setForm({
      title: risk.title,
      description: risk.description ?? '',
      category: risk.category ?? '',
      probability: risk.probability,
      impact: risk.impact,
      status: risk.status,
      strategy: risk.strategy ?? '',
      mitigationPlan: risk.mitigationPlan ?? '',
      contingencyPlan: risk.contingencyPlan ?? '',
      dueDate: risk.dueDate ?? '',
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (form.title.trim() === '') return;
    const input: RiskFormInput = {
      title: form.title.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      category: form.category.trim() === '' ? null : form.category.trim(),
      probability: form.probability,
      impact: form.impact,
      status: form.status,
      strategy: form.strategy === '' ? null : form.strategy,
      mitigationPlan: form.mitigationPlan.trim() === '' ? null : form.mitigationPlan.trim(),
      contingencyPlan: form.contingencyPlan.trim() === '' ? null : form.contingencyPlan.trim(),
      dueDate: form.dueDate === '' ? null : form.dueDate,
    };
    try {
      if (editingId === null) {
        await createRisk.mutateAsync(input);
        toast.success(t('created'));
      } else {
        await updateRisk.mutateAsync({ id: editingId, input });
        toast.success(t('updated'));
      }
      setFormOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteRisk.mutateAsync(id);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (risks.data === undefined) return <Skeleton className="h-32" />;

  const openRisks = risks.data.filter((risk) => risk.status !== 'closed');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium text-fg">{t('matrixTitle')}</p>
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `auto repeat(${SCALE.length}, minmax(2.5rem, 1fr))` }}
        >
          <div />
          {SCALE.map((impact) => (
            <div key={impact} className="text-center text-xs text-fg-muted">
              {impact}
            </div>
          ))}
          {[...SCALE].reverse().map((probability) => (
            <>
              <div key={`label-${probability}`} className="pe-1 text-end text-xs text-fg-muted">
                {probability}
              </div>
              {SCALE.map((impact) => {
                const count = openRisks.filter(
                  (risk) => risk.probability === probability && risk.impact === impact,
                ).length;
                const score = probability * impact;
                return (
                  <div
                    key={`${probability}-${impact}`}
                    className={`flex h-10 items-center justify-center rounded text-sm font-medium ${
                      count === 0
                        ? 'bg-surface-sunken text-fg-subtle'
                        : toneForScore(score) === 'danger'
                          ? 'bg-danger-soft text-danger'
                          : toneForScore(score) === 'warning'
                            ? 'bg-warning-soft text-warning'
                            : 'bg-success-soft text-success'
                    }`}
                  >
                    {count > 0 ? count : ''}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>

      {risks.data.length === 0 ? (
        <EmptyState icon={<AlertTriangle aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {risks.data.map((risk) => (
            <li key={risk.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-fg">{risk.title}</p>
                  <p className="text-xs text-fg-muted">
                    {t('probability')}: {risk.probability} · {t('impact')}: {risk.impact}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={toneForScore(risk.probability * risk.impact)}>{t(`status.${risk.status}`)}</Badge>
                  {canManage ? (
                    <>
                      <IconButton
                        label={t('edit')}
                        icon={<Pencil aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          startEdit(risk);
                        }}
                      />
                      <IconButton
                        label={t('delete')}
                        icon={<Trash2 aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void remove(risk.id);
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
              <Field label={t('probability')}>
                <Select
                  value={String(form.probability)}
                  options={scaleOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, probability: Number(value) }));
                  }}
                />
              </Field>
              <Field label={t('impact')}>
                <Select
                  value={String(form.impact)}
                  options={scaleOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, impact: Number(value) }));
                  }}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('statusField')}>
                <Select
                  value={form.status}
                  options={statusOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, status: value as RiskStatus }));
                  }}
                />
              </Field>
              <Field label={t('strategyField')}>
                <Select
                  value={form.strategy}
                  options={strategyOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, strategy: value as RiskStrategy | '' }));
                  }}
                />
              </Field>
            </div>
            <Field label={t('mitigationPlan')}>
              <Textarea
                value={form.mitigationPlan}
                onChange={(event) => {
                  setForm((current) => ({ ...current, mitigationPlan: event.target.value }));
                }}
                rows={2}
              />
            </Field>
            <Field label={t('contingencyPlan')}>
              <Textarea
                value={form.contingencyPlan}
                onChange={(event) => {
                  setForm((current) => ({ ...current, contingencyPlan: event.target.value }));
                }}
                rows={2}
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
                loading={createRisk.isPending || updateRisk.isPending}
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
