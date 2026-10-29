'use client';

import { Button, DatePicker, Field, Input, Modal, Select, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Portfolio, Program } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateProgram, useUpdateProgram } from './model';

const STATUSES = ['proposed', 'planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

export interface ProgramDialogProps {
  workspaceId: string;
  portfolios: Portfolio[];
  program?: Program;
  defaultPortfolioId?: string | null;
  onClose: () => void;
}

export function ProgramDialog({ workspaceId, portfolios, program, defaultPortfolioId, onClose }: ProgramDialogProps) {
  const t = useTranslations('portfolio');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateProgram(workspaceId);
  const update = useUpdateProgram(workspaceId);
  const isEdit = program !== undefined;

  const [name, setName] = useState(program?.name ?? '');
  const [description, setDescription] = useState(program?.description ?? '');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(program?.status ?? 'active');
  const [portfolioId, setPortfolioId] = useState(program?.portfolioId ?? defaultPortfolioId ?? '');
  const [startDate, setStartDate] = useState<string | null>(program?.startDate ?? null);
  const [endDate, setEndDate] = useState<string | null>(program?.endDate ?? null);

  const save = async () => {
    if (name.trim() === '') return;
    const input = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      status,
      portfolioId: portfolioId === '' ? null : portfolioId,
      startDate,
      endDate,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: program.id, input });
      else await create.mutateAsync(input);
      toast.success(isEdit ? t('portfolios.programUpdated') : t('portfolios.programCreated'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('portfolios.editProgramTitle') : t('portfolios.newProgramTitle')}
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
        <Field label={t('tabs.portfolios')}>
          <Select
            value={portfolioId}
            onValueChange={setPortfolioId}
            options={[
              { value: '', label: t('portfolios.standalonePortfolio') },
              ...portfolios.map((portfolio) => ({ value: portfolio.id, label: portfolio.name })),
            ]}
          />
        </Field>
        <Field label={t('portfolios.status')}>
          <Select
            value={status}
            onValueChange={(value) => { setStatus(value as (typeof STATUSES)[number]); }}
            options={STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('portfolios.startDate')}>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              label={t('portfolios.startDate')}
              placeholder={t('portfolios.startDate')}
              clearLabel={tc('clear')}
            />
          </Field>
          <Field label={t('portfolios.endDate')}>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              label={t('portfolios.endDate')}
              placeholder={t('portfolios.endDate')}
              clearLabel={tc('clear')}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
