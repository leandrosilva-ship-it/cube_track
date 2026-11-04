'use client';

import { AI_FEATURES, AI_MODELS, type AiModel } from '@cube-track/shared';
import { Button, Field, Input, Select, Skeleton, Switch, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorMessage } from '@/lib/errors/use-error-message';
import type { AiSettings } from '@/lib/api/types';

import { useAiSettings, useAiUsage, useUpdateAiSettings } from './hooks';
import { centsToUnits, unitsToCents } from './model';

/** Seção "Inteligência Artificial" das configurações da organização (ADR 0055) — visível só com
 * `ai.manage` (TENANT). A chave de API é write-only: `hasApiKey` é o único sinal de que há uma
 * configurada; o campo nunca é pré-preenchido com o valor real. */
export function AiSettingsSection() {
  const settings = useAiSettings();

  if (settings.data === undefined) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-6">
      <AiSettingsForm key={settings.data.updatedAt ?? 'new'} settings={settings.data} />
      <AiUsageTable />
    </div>
  );
}

function AiSettingsForm({ settings }: { settings: AiSettings }) {
  const t = useTranslations('ai.settings');
  const errorMessage = useErrorMessage();
  const update = useUpdateAiSettings();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [model, setModel] = useState<AiModel>(settings.model);
  const [apiKey, setApiKey] = useState('');
  const [tokenLimit, setTokenLimit] = useState(settings.monthlyTokenLimit?.toString() ?? '');
  const [costLimit, setCostLimit] = useState(centsToUnits(settings.monthlyCostLimitCents));

  const showEnableWarning = enabled && !settings.enabled;

  const save = async () => {
    try {
      await update.mutateAsync({
        enabled,
        model,
        ...(apiKey.trim() === '' ? {} : { apiKey: apiKey.trim() }),
        monthlyTokenLimit: tokenLimit.trim() === '' ? null : Number(tokenLimit),
        monthlyCostLimitCents: unitsToCents(costLimit),
      });
      setApiKey('');
      toast.success(t('saved'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('enabledLabel')} />
        {t('enabledLabel')}
      </label>
      {showEnableWarning ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{t('enabledOnWarning')}</p>
      ) : null}
      {!settings.enabled && !showEnableWarning ? (
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-fg-muted">{t('disabledWarning')}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('providerLabel')}>
          <Input value={settings.provider} disabled readOnly />
        </Field>
        <Field label={t('modelLabel')}>
          <Select
            value={model}
            options={AI_MODELS.map((value) => ({ value, label: value }))}
            onValueChange={(value) => {
              setModel(value as AiModel);
            }}
          />
        </Field>
      </div>

      <Field label={t('apiKeyLabel')} hint={t('apiKeyHint')}>
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={settings.hasApiKey ? t('apiKeySetPlaceholder') : t('apiKeyUnsetPlaceholder')}
          onChange={(event) => {
            setApiKey(event.target.value);
          }}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('monthlyTokenLimitLabel')} hint={t('monthlyTokenLimitHint')}>
          <Input
            type="number"
            min={0}
            value={tokenLimit}
            onChange={(event) => {
              setTokenLimit(event.target.value);
            }}
          />
        </Field>
        <Field label={t('monthlyCostLimitLabel')} hint={t('monthlyCostLimitHint')}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={costLimit}
            onChange={(event) => {
              setCostLimit(event.target.value);
            }}
          />
        </Field>
      </div>

      <Button className="self-start" loading={update.isPending} onClick={() => void save()}>
        {t('save')}
      </Button>
    </div>
  );
}

function AiUsageTable() {
  const t = useTranslations('ai.settings');
  const usage = useAiUsage();

  if (usage.data === undefined) return <Skeleton className="h-32" />;

  const byFeature = new Map(usage.data.map((entry) => [entry.feature, entry]));
  const rows = AI_FEATURES.map((feature) => byFeature.get(feature) ?? { feature, tokens: 0, costCents: 0, calls: 0 });
  const hasUsage = rows.some((row) => row.calls > 0);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-fg">{t('usageTitle')}</h3>
      {!hasUsage ? (
        <p className="text-sm text-fg-subtle">{t('usageEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunken text-start text-xs uppercase text-fg-subtle">
                <th className="px-3 py-2 text-start font-medium">{t('usageFeature')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('usageTokens')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('usageCost')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('usageCalls')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feature} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{t(`feature.${row.feature}`)}</td>
                  <td className="px-3 py-2 text-end">{row.tokens.toLocaleString()}</td>
                  <td className="px-3 py-2 text-end">{(row.costCents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-end">{row.calls.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
