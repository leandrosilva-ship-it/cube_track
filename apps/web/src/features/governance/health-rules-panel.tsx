'use client';

import { Button, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@cube-track/ui';
import { defaultHealthRules } from '@cube-track/shared';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type {
  HealthRule,
  HealthRuleDimension,
  HealthRuleMetric,
  HealthRuleOperator,
  HealthStatus,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useBoardHealthRules, useDefaultHealthRules, useSetBoardHealthRules } from './model';

const DIMENSIONS: HealthRuleDimension[] = ['overall', 'schedule', 'cost', 'scope', 'quality', 'risk'];
const METRICS: HealthRuleMetric[] = ['spi', 'cpi', 'overdue_items_pct', 'open_critical_risks', 'budget_variance_pct'];
const OPERATORS: HealthRuleOperator[] = ['lt', 'lte', 'gt', 'gte', 'eq'];
const RESULTS: HealthStatus[] = ['green', 'yellow', 'red', 'grey'];

const EMPTY_RULE: HealthRule = { dimension: 'schedule', metric: 'spi', operator: 'lt', threshold: 0.9, result: 'yellow' };

export interface HealthRulesPanelProps {
  boardId: string;
  canManage: boolean;
}

export function HealthRulesPanel({ boardId, canManage }: HealthRulesPanelProps) {
  const t = useTranslations('governance.healthRules');
  const errorMessage = useErrorMessage();
  const boardRules = useBoardHealthRules(boardId);
  const tenantDefault = useDefaultHealthRules();
  const setRules = useSetBoardHealthRules(boardId);
  const [rules, setLocalRules] = useState<HealthRule[] | null>(null);

  const dimensionOptions = DIMENSIONS.map((dimension) => ({ value: dimension, label: t(`dimensionLabel.${dimension}`) }));
  const metricOptions = METRICS.map((metric) => ({ value: metric, label: t(`metricLabel.${metric}`) }));
  const operatorOptions = OPERATORS.map((operator) => ({ value: operator, label: t(`operatorLabel.${operator}`) }));
  const resultOptions = RESULTS.map((status) => ({ value: status, label: status }));

  if (boardRules.data === undefined) return <Skeleton className="h-32" />;
  const current = rules ?? boardRules.data.rules;

  const updateRule = (index: number, patch: Partial<HealthRule>) => {
    setLocalRules(current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (index: number) => {
    setLocalRules(current.filter((_, i) => i !== index));
  };

  const addRule = () => {
    setLocalRules([...current, EMPTY_RULE]);
  };

  const startFromDefault = () => {
    setLocalRules(defaultHealthRules());
  };

  const save = async () => {
    try {
      await setRules.mutateAsync(current);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const useTenantDefault = () => {
    setLocalRules(tenantDefault.data?.rules ?? defaultHealthRules());
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-fg">{t('title')}</p>
        <p className="text-sm text-fg-muted">{t('description')}</p>
      </div>

      {current.length === 0 ? (
        <EmptyState icon={<ListChecks aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {current.map((rule, index) => (
            <li
              key={`${rule.dimension}-${rule.metric}-${index}`}
              className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-6 sm:items-end"
            >
              <Field label={t('dimension')}>
                <Select
                  value={rule.dimension}
                  options={dimensionOptions}
                  onValueChange={(value) => {
                    updateRule(index, { dimension: value as HealthRuleDimension });
                  }}
                  disabled={!canManage}
                />
              </Field>
              <Field label={t('metric')}>
                <Select
                  value={rule.metric}
                  options={metricOptions}
                  onValueChange={(value) => {
                    updateRule(index, { metric: value as HealthRuleMetric });
                  }}
                  disabled={!canManage}
                />
              </Field>
              <Field label={t('operator')}>
                <Select
                  value={rule.operator}
                  options={operatorOptions}
                  onValueChange={(value) => {
                    updateRule(index, { operator: value as HealthRuleOperator });
                  }}
                  disabled={!canManage}
                />
              </Field>
              <Field label={t('threshold')}>
                <Input
                  value={String(rule.threshold)}
                  onChange={(event) => {
                    updateRule(index, { threshold: Number(event.target.value) || 0 });
                  }}
                  disabled={!canManage}
                />
              </Field>
              <Field label={t('result')}>
                <Select
                  value={rule.result}
                  options={resultOptions}
                  onValueChange={(value) => {
                    updateRule(index, { result: value as HealthStatus });
                  }}
                  disabled={!canManage}
                />
              </Field>
              {canManage ? (
                <IconButton
                  label={t('removeRule')}
                  icon={<Trash2 aria-hidden="true" />}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    removeRule(index);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={addRule}>
              <Plus aria-hidden="true" />
              {t('addRule')}
            </Button>
            <Button variant="ghost" size="sm" onClick={startFromDefault}>
              {t('startFromDefault')}
            </Button>
            <Button variant="ghost" size="sm" onClick={useTenantDefault}>
              {t('useDefault')}
            </Button>
          </div>
          <Button loading={setRules.isPending} onClick={() => void save()}>
            {t('save')}
          </Button>
        </div>
      ) : null}
      {canManage ? <p className="text-xs text-fg-muted">{t('useDefaultHint')}</p> : null}
    </div>
  );
}
