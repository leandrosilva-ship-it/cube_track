'use client';

import { Button, Field, Input, Modal, Select, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ScoringModel } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useSetScore } from './model';

const WSJF_KEYS = ['business_value', 'time_criticality', 'risk_reduction', 'job_size'] as const;

export interface ScoreBoardDialogProps {
  model: ScoringModel;
  boards: { id: string; name: string }[];
  onClose: () => void;
}

/** Pontua um projeto num modelo (ponderado: um valor por critério; WSJF: os 4 campos fixos). */
export function ScoreBoardDialog({ model, boards, onClose }: ScoreBoardDialogProps) {
  const t = useTranslations('portfolio');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const setScore = useSetScore();

  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState('');

  const keys = model.method === 'wsjf' ? WSJF_KEYS : model.criteria.map((c) => c.key);
  const wsjfLabels: Record<string, string> = {
    business_value: t('scoring.wsjfFields.business_value'),
    time_criticality: t('scoring.wsjfFields.time_criticality'),
    risk_reduction: t('scoring.wsjfFields.risk_reduction'),
    job_size: t('scoring.wsjfFields.job_size'),
  };
  const labels =
    model.method === 'wsjf'
      ? new Map(Object.entries(wsjfLabels))
      : new Map(model.criteria.map((c) => [c.key, c.label]));

  const valid = boardId !== '' && keys.every((key) => values[key] !== undefined && values[key] !== '' && !Number.isNaN(Number(values[key])));

  const save = async () => {
    if (!valid) return;
    const criteriaScores = Object.fromEntries(keys.map((key) => [key, Number(values[key])]));
    try {
      await setScore.mutateAsync({
        boardId,
        input: { scoringModelId: model.id, criteriaScores, rationale: rationale.trim() === '' ? null : rationale.trim() },
      });
      toast.success(t('scoring.scored'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('scoring.scoreBoardTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={setScore.isPending} disabled={!valid}>
            {t('scoring.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('scoring.board')}>
          <Select value={boardId} onValueChange={setBoardId} options={boards.map((board) => ({ value: board.id, label: board.name }))} />
        </Field>
        {keys.map((key) => (
          <Field key={key} label={labels.get(key) ?? key}>
            <Input
              type="number"
              value={values[key] ?? ''}
              onChange={(event) => { setValues((current) => ({ ...current, [key]: event.target.value })); }}
            />
          </Field>
        ))}
        <Field label={t('scoring.rationale')}>
          <Textarea value={rationale} onChange={(event) => { setRationale(event.target.value); }} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
