'use client';

import { Button, Field, Input, Modal, Select, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { HealthStatus } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useReportProjectHealth } from './hooks';

const DIMENSIONS = ['schedule', 'cost', 'scope', 'quality', 'risk'] as const;
const STATUSES: HealthStatus[] = ['green', 'yellow', 'red', 'grey'];

export interface ProjectHealthDialogProps {
  boardId: string;
  onClose: () => void;
}

/** Diálogo de relato de saúde do projeto (`board.manage`), série histórica manual (ADR 0050). */
export function ProjectHealthDialog({ boardId, onClose }: ProjectHealthDialogProps) {
  const t = useTranslations('dashboards.projectHealth');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const report = useReportProjectHealth(boardId);
  const [overall, setOverall] = useState<HealthStatus>('green');
  const [dimensions, setDimensions] = useState<Record<(typeof DIMENSIONS)[number], HealthStatus>>({
    schedule: 'grey',
    cost: 'grey',
    scope: 'grey',
    quality: 'grey',
    risk: 'grey',
  });
  const [percentComplete, setPercentComplete] = useState('');
  const [spi, setSpi] = useState('');
  const [cpi, setCpi] = useState('');
  const [summary, setSummary] = useState('');

  const statusOptions = STATUSES.map((status) => ({ value: status, label: t(`status.${status}`) }));

  const submit = async () => {
    try {
      await report.mutateAsync({
        overall,
        ...dimensions,
        ...(percentComplete === '' ? {} : { percentComplete: Number(percentComplete) }),
        ...(spi === '' ? {} : { spi: Number(spi) }),
        ...(cpi === '' ? {} : { cpi: Number(cpi) }),
        ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
      });
      toast.success(t('reported'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('dialogTitle')}
      description={t('dialogDescription')}
      closeLabel={tc('close')}
      footer={
        <Button
          loading={report.isPending}
          onClick={() => {
            void submit();
          }}
        >
          {t('submit')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('dimension.overall')}>
          <Select
            value={overall}
            options={statusOptions}
            onValueChange={(value) => {
              setOverall(value as HealthStatus);
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {DIMENSIONS.map((dimension) => (
            <Field key={dimension} label={t(`dimension.${dimension}`)}>
              <Select
                value={dimensions[dimension]}
                options={statusOptions}
                onValueChange={(value) => {
                  setDimensions((current) => ({ ...current, [dimension]: value as HealthStatus }));
                }}
              />
            </Field>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('percentComplete')}>
            <Input
              type="number"
              min={0}
              max={100}
              value={percentComplete}
              onChange={(event) => {
                setPercentComplete(event.target.value);
              }}
            />
          </Field>
          <Field label="SPI">
            <Input
              type="number"
              step="0.01"
              value={spi}
              onChange={(event) => {
                setSpi(event.target.value);
              }}
            />
          </Field>
          <Field label="CPI">
            <Input
              type="number"
              step="0.01"
              value={cpi}
              onChange={(event) => {
                setCpi(event.target.value);
              }}
            />
          </Field>
        </div>
        <Field label={t('summary')}>
          <Textarea
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
            rows={3}
          />
        </Field>
      </div>
    </Modal>
  );
}
