'use client';

import { Badge, Button, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@cube-track/ui';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BudgetCategory, CostEntryKind, PortfolioBudget, ProjectHealthEntry } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useBudgetsOfBoard,
  useCostEntries,
  useCreateBudget,
  useCreateCostEntry,
  useDeleteBudget,
  useDeleteCostEntry,
} from './model';

const BUDGET_CATEGORIES: BudgetCategory[] = ['capex', 'opex'];
const COST_ENTRY_KINDS: CostEntryKind[] = ['planned', 'actual', 'forecast'];

interface BudgetFormState {
  name: string;
  category: BudgetCategory;
  currency: string;
  plannedAmount: string;
  fiscalYear: string;
}

const EMPTY_FORM: BudgetFormState = {
  name: '',
  category: 'opex',
  currency: 'BRL',
  plannedAmount: '',
  fiscalYear: '',
};

interface CostEntryFormState {
  entryDate: string;
  amount: string;
  kind: CostEntryKind;
  category: string;
  description: string;
}

const EMPTY_COST_ENTRY_FORM: CostEntryFormState = {
  entryDate: '',
  amount: '',
  kind: 'actual',
  category: '',
  description: '',
};

function EvmSummary({ latest }: { latest: ProjectHealthEntry | null }) {
  const t = useTranslations('governance.budget.evm');
  if (latest?.plannedValue === null || latest?.plannedValue === undefined) {
    return <p className="text-sm text-fg-muted">{t('noData')}</p>;
  }
  const rows: { label: string; value: string | null }[] = [
    { label: t('pv'), value: latest.plannedValue },
    { label: t('ev'), value: latest.earnedValue },
    { label: t('ac'), value: latest.actualCost },
    { label: t('spi'), value: latest.spi },
    { label: t('cpi'), value: latest.cpi },
    { label: t('eac'), value: latest.eac },
    { label: t('vac'), value: latest.vac },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-xs text-fg-muted">{row.label}</dt>
          <dd className="font-medium tabular-nums text-fg">{row.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function CostEntriesSection({ budgetId, canManage }: { budgetId: string; canManage: boolean }) {
  const t = useTranslations('governance.budget.costEntries');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const costEntries = useCostEntries(budgetId);
  const createCostEntry = useCreateCostEntry(budgetId);
  const deleteCostEntry = useDeleteCostEntry(budgetId);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CostEntryFormState>(EMPTY_COST_ENTRY_FORM);

  const kindOptions = COST_ENTRY_KINDS.map((kind) => ({ value: kind, label: t(`kindLabel.${kind}`) }));

  const submit = async () => {
    if (form.entryDate === '' || form.amount.trim() === '') return;
    try {
      await createCostEntry.mutateAsync({
        entryDate: form.entryDate,
        amount: form.amount.trim(),
        kind: form.kind,
        category: form.category.trim() === '' ? null : form.category.trim(),
        description: form.description.trim() === '' ? null : form.description.trim(),
      });
      toast.success(t('created'));
      setForm(EMPTY_COST_ENTRY_FORM);
      setFormOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteCostEntry.mutateAsync(id);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (costEntries.data === undefined) return <Skeleton className="h-16" />;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-sm font-medium text-fg">{t('title')}</p>
      {costEntries.data.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {costEntries.data.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {entry.entryDate} · {entry.amount} {entry.currency} ·{' '}
                <Badge tone="neutral">{t(`kindLabel.${entry.kind}`)}</Badge>
              </span>
              {canManage ? (
                <IconButton
                  label={t('delete')}
                  icon={<Trash2 aria-hidden="true" />}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void remove(entry.id);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        formOpen ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('entryDate')}>
                <Input
                  type="date"
                  value={form.entryDate}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, entryDate: event.target.value }));
                  }}
                />
              </Field>
              <Field label={t('amount')}>
                <Input
                  value={form.amount}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, amount: event.target.value }));
                  }}
                />
              </Field>
            </div>
            <Field label={t('kind')}>
              <Select
                value={form.kind}
                options={kindOptions}
                onValueChange={(value) => {
                  setForm((current) => ({ ...current, kind: value as CostEntryKind }));
                }}
              />
            </Field>
            <Field label={t('category')}>
              <Input
                value={form.category}
                onChange={(event) => {
                  setForm((current) => ({ ...current, category: event.target.value }));
                }}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFormOpen(false);
                }}
              >
                {tc('cancel')}
              </Button>
              <Button
                size="sm"
                loading={createCostEntry.isPending}
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
            variant="ghost"
            size="sm"
            onClick={() => {
              setFormOpen(true);
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

export interface BudgetPanelProps {
  boardId: string;
  healthLatest: ProjectHealthEntry | null;
  canManage: boolean;
}

export function BudgetPanel({ boardId, healthLatest, canManage }: BudgetPanelProps) {
  const t = useTranslations('governance.budget');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const budgets = useBudgetsOfBoard(boardId);
  const createBudget = useCreateBudget(boardId);
  const deleteBudget = useDeleteBudget(boardId);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<BudgetFormState>(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const categoryOptions = BUDGET_CATEGORIES.map((category) => ({
    value: category,
    label: t(`categoryLabel.${category}`),
  }));

  const submit = async () => {
    if (form.name.trim() === '' || form.plannedAmount.trim() === '') return;
    try {
      await createBudget.mutateAsync({
        name: form.name.trim(),
        category: form.category,
        currency: form.currency.trim() === '' ? 'BRL' : form.currency.trim(),
        plannedAmount: form.plannedAmount.trim(),
        fiscalYear: form.fiscalYear === '' ? null : Number(form.fiscalYear),
      });
      toast.success(t('created'));
      setForm(EMPTY_FORM);
      setFormOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteBudget.mutateAsync(id);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium text-fg">{t('evm.title')}</p>
        <EvmSummary latest={healthLatest} />
      </div>

      {budgets.data === undefined ? (
        <Skeleton className="h-24" />
      ) : budgets.data.length === 0 ? (
        <EmptyState icon={<Wallet aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {budgets.data.map((budget: PortfolioBudget) => (
            <li key={budget.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="text-start"
                  onClick={() => {
                    setExpandedId((current) => (current === budget.id ? null : budget.id));
                  }}
                >
                  <p className="font-medium text-fg">{budget.name}</p>
                  <p className="text-xs text-fg-muted">
                    {budget.plannedAmount} {budget.currency}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{t(`categoryLabel.${budget.category}`)}</Badge>
                  {canManage ? (
                    <IconButton
                      label={t('delete')}
                      icon={<Trash2 aria-hidden="true" />}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void remove(budget.id);
                      }}
                    />
                  ) : null}
                </div>
              </div>
              {expandedId === budget.id ? (
                <CostEntriesSection budgetId={budget.id} canManage={canManage} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        formOpen ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <Field label={t('name')}>
              <Input
                value={form.name}
                onChange={(event) => {
                  setForm((current) => ({ ...current, name: event.target.value }));
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('category')}>
                <Select
                  value={form.category}
                  options={categoryOptions}
                  onValueChange={(value) => {
                    setForm((current) => ({ ...current, category: value as BudgetCategory }));
                  }}
                />
              </Field>
              <Field label={t('currency')}>
                <Input
                  value={form.currency}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, currency: event.target.value }));
                  }}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('plannedAmount')}>
                <Input
                  value={form.plannedAmount}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, plannedAmount: event.target.value }));
                  }}
                />
              </Field>
              <Field label={t('fiscalYear')}>
                <Input
                  value={form.fiscalYear}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, fiscalYear: event.target.value }));
                  }}
                />
              </Field>
            </div>
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
                loading={createBudget.isPending}
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
              setFormOpen(true);
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
