'use client';

import { Button, Checkbox, Field, IconButton, Input, Modal, Select, Textarea, toast } from '@cube-track/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ScoringCriterion, ScoringMethod, ScoringModel } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateScoringModel, useUpdateScoringModel } from './model';

const WSJF_CRITERIA: ScoringCriterion[] = [
  { key: 'business_value', label: 'Valor de negócio', weight: 1, scaleMin: 1, scaleMax: 10, higherIsBetter: true },
  { key: 'time_criticality', label: 'Criticidade de tempo', weight: 1, scaleMin: 1, scaleMax: 10, higherIsBetter: true },
  { key: 'risk_reduction', label: 'Redução de risco / habilitação de oportunidade', weight: 1, scaleMin: 1, scaleMax: 10, higherIsBetter: true },
  { key: 'job_size', label: 'Tamanho do trabalho', weight: 1, scaleMin: 1, scaleMax: 10, higherIsBetter: false },
];

function emptyCriterion(): ScoringCriterion {
  return { key: '', label: '', weight: 1, scaleMin: 1, scaleMax: 10, higherIsBetter: true };
}

export interface ScoringModelDialogProps {
  model?: ScoringModel;
  onClose: () => void;
}

export function ScoringModelDialog({ model, onClose }: ScoringModelDialogProps) {
  const t = useTranslations('portfolio');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateScoringModel();
  const update = useUpdateScoringModel();
  const isEdit = model !== undefined;

  const [name, setName] = useState(model?.name ?? '');
  const [description, setDescription] = useState(model?.description ?? '');
  const [method, setMethod] = useState<ScoringMethod>(model?.method ?? 'weighted');
  const [criteria, setCriteria] = useState<ScoringCriterion[]>(model?.criteria ?? [emptyCriterion()]);
  const [isDefault, setIsDefault] = useState(model?.isDefault ?? false);
  const wsjfFieldLabels = new Map<string, string>([
    ['business_value', t('scoring.wsjfFields.business_value')],
    ['time_criticality', t('scoring.wsjfFields.time_criticality')],
    ['risk_reduction', t('scoring.wsjfFields.risk_reduction')],
    ['job_size', t('scoring.wsjfFields.job_size')],
  ]);

  const effectiveCriteria = method === 'wsjf' ? WSJF_CRITERIA : criteria;
  const valid =
    name.trim() !== '' &&
    (method === 'wsjf' ||
      (criteria.length > 0 && criteria.every((c) => c.key.trim() !== '' && c.label.trim() !== '' && c.scaleMax > c.scaleMin)));

  const save = async () => {
    if (!valid) return;
    const input = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      method,
      criteria: effectiveCriteria,
      isDefault,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: model.id, input });
      else await create.mutateAsync(input);
      toast.success(isEdit ? t('scoring.updated') : t('scoring.created'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const updateCriterion = (index: number, patch: Partial<ScoringCriterion>) => {
    setCriteria((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  return (
    <Modal
      title={isEdit ? t('scoring.editTitle') : t('scoring.newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={create.isPending || update.isPending} disabled={!valid}>
            {t('scoring.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('scoring.name')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('scoring.description')}>
          <Textarea value={description} onChange={(event) => { setDescription(event.target.value); }} rows={2} />
        </Field>
        <Field label={t('scoring.method')}>
          <Select
            value={method}
            onValueChange={(value) => { setMethod(value as ScoringMethod); }}
            options={[
              { value: 'weighted', label: t('scoring.methodOptions.weighted') },
              { value: 'wsjf', label: t('scoring.methodOptions.wsjf') },
            ]}
          />
        </Field>
        <div className="flex items-center gap-2">
          <Checkbox id="scoring-default" checked={isDefault} onCheckedChange={(value) => { setIsDefault(value === true); }} />
          <label htmlFor="scoring-default" className="text-sm">
            {t('scoring.isDefault')}
          </label>
        </div>

        {method === 'wsjf' ? (
          <ul className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm text-fg-muted">
            {WSJF_CRITERIA.map((criterion) => (
              <li key={criterion.key}>{wsjfFieldLabels.get(criterion.key) ?? criterion.label}</li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">{t('scoring.criteria')}</h4>
            {criteria.map((criterion, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                <Field label={t('scoring.criterionKey')} className="w-28">
                  <Input value={criterion.key} onChange={(event) => { updateCriterion(index, { key: event.target.value }); }} />
                </Field>
                <Field label={t('scoring.criterionLabel')} className="w-40">
                  <Input value={criterion.label} onChange={(event) => { updateCriterion(index, { label: event.target.value }); }} />
                </Field>
                <Field label={t('scoring.weight')} className="w-20">
                  <Input
                    type="number"
                    value={criterion.weight}
                    onChange={(event) => { updateCriterion(index, { weight: Number(event.target.value) }); }}
                  />
                </Field>
                <Field label={t('scoring.scaleMin')} className="w-20">
                  <Input
                    type="number"
                    value={criterion.scaleMin}
                    onChange={(event) => { updateCriterion(index, { scaleMin: Number(event.target.value) }); }}
                  />
                </Field>
                <Field label={t('scoring.scaleMax')} className="w-20">
                  <Input
                    type="number"
                    value={criterion.scaleMax}
                    onChange={(event) => { updateCriterion(index, { scaleMax: Number(event.target.value) }); }}
                  />
                </Field>
                <div className="flex items-center gap-1.5 pb-2">
                  <Checkbox
                    id={`higher-${index}`}
                    checked={criterion.higherIsBetter}
                    onCheckedChange={(value) => { updateCriterion(index, { higherIsBetter: value === true }); }}
                  />
                  <label htmlFor={`higher-${index}`} className="text-xs">
                    {t('scoring.higherIsBetter')}
                  </label>
                </div>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={t('scoring.removeCriterion')}
                  icon={<Trash2 className="size-4" aria-hidden="true" />}
                  onClick={() => { setCriteria((current) => current.filter((_, i) => i !== index)); }}
                  disabled={criteria.length <= 1}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setCriteria((current) => [...current, emptyCriterion()]); }}
            >
              {t('scoring.addCriterion')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
