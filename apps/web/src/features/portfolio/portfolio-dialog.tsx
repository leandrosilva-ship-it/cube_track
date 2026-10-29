'use client';

import { Button, Field, Input, Modal, Select, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Portfolio, ScoringModel } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreatePortfolio, useUpdatePortfolio } from './model';

const STATUSES = ['proposed', 'planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

export interface PortfolioDialogProps {
  workspaceId: string;
  portfolio?: Portfolio;
  scoringModels: ScoringModel[];
  onClose: () => void;
}

export function PortfolioDialog({ workspaceId, portfolio, scoringModels, onClose }: PortfolioDialogProps) {
  const t = useTranslations('portfolio');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreatePortfolio(workspaceId);
  const update = useUpdatePortfolio(workspaceId);
  const isEdit = portfolio !== undefined;

  const [name, setName] = useState(portfolio?.name ?? '');
  const [description, setDescription] = useState(portfolio?.description ?? '');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(portfolio?.status ?? 'active');
  const [scoringModelId, setScoringModelId] = useState(portfolio?.scoringModelId ?? '');

  const save = async () => {
    if (name.trim() === '') return;
    const input = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      status,
      scoringModelId: scoringModelId === '' ? null : scoringModelId,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: portfolio.id, input });
      else await create.mutateAsync(input);
      toast.success(isEdit ? t('portfolios.updated') : t('portfolios.created'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('portfolios.editTitle') : t('portfolios.newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={create.isPending || update.isPending} disabled={name.trim() === ''}>
            {t('portfolios.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('portfolios.name')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('portfolios.description')}>
          <Textarea value={description} onChange={(event) => { setDescription(event.target.value); }} rows={3} />
        </Field>
        <Field label={t('portfolios.status')}>
          <Select
            value={status}
            onValueChange={(value) => { setStatus(value as (typeof STATUSES)[number]); }}
            options={STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          />
        </Field>
        <Field label={t('portfolios.scoringModel')}>
          <Select
            value={scoringModelId}
            onValueChange={setScoringModelId}
            options={[
              { value: '', label: t('portfolios.none') },
              ...scoringModels.map((model) => ({ value: model.id, label: model.name })),
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}
