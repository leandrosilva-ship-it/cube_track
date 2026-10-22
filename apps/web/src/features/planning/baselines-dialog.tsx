'use client';

import { formatDateTime } from '@cube-track/i18n';
import { Button, Field, IconButton, Input, Modal, toast } from '@cube-track/ui';
import { Star, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Baseline } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useBaselines,
  useCaptureBaseline,
  useDeleteBaseline,
  useSetPrimaryBaseline,
} from './hooks';

export interface BaselinesDialogProps {
  boardId: string;
  canEdit: boolean;
  comparingId: string | null;
  onCompare: (baselineId: string | null) => void;
  onClose: () => void;
}

/** Baselines do board: capturar, listar, definir primária e comparar no Gantt (ADR 0049). */
export function BaselinesDialog({ boardId, canEdit, comparingId, onCompare, onClose }: BaselinesDialogProps) {
  const t = useTranslations('gantt.baselinesDialog');
  const tc = useTranslations('common');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const query = useBaselines(boardId);
  const capture = useCaptureBaseline(boardId);
  const setPrimary = useSetPrimaryBaseline(boardId);
  const deleteBaseline = useDeleteBaseline(boardId);

  const [name, setName] = useState('');

  const submitCapture = async () => {
    if (name.trim() === '') return;
    try {
      await capture.mutateAsync({ name: name.trim() });
      toast.success(t('captured'));
      setName('');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const makePrimary = async (baseline: Baseline) => {
    try {
      await setPrimary.mutateAsync(baseline.id);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeBaseline = async (baseline: Baseline) => {
    if (!window.confirm(t('deleteConfirm', { name: baseline.name }))) return;
    try {
      await deleteBaseline.mutateAsync(baseline.id);
      if (comparingId === baseline.id) onCompare(null);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const baselines = query.data ?? [];

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-xl"
      footer={<Button onClick={onClose}>{tc('close')}</Button>}
    >
      <div className="flex flex-col gap-3">
        {baselines.length === 0 && !query.isLoading ? (
          <p className="text-sm text-fg-muted">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {baselines.map((baseline) => (
              <li
                key={baseline.id}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{baseline.name}</p>
                  <p className="text-xs text-fg-muted">
                    {t('capturedAt', { date: formatDateTime(baseline.capturedAt, locale) })}
                  </p>
                </div>
                {baseline.isPrimary ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs text-primary">
                    {t('primary')}
                  </span>
                ) : canEdit ? (
                  <IconButton
                    label={t('setPrimary')}
                    icon={<Star aria-hidden="true" />}
                    size="icon-sm"
                    onClick={() => {
                      void makePrimary(baseline);
                    }}
                  />
                ) : null}
                <Button
                  variant={comparingId === baseline.id ? 'subtle' : 'secondary'}
                  size="sm"
                  onClick={() => {
                    onCompare(comparingId === baseline.id ? null : baseline.id);
                  }}
                >
                  {comparingId === baseline.id ? t('stopComparing') : t('compare')}
                </Button>
                {canEdit ? (
                  <IconButton
                    label={t('delete')}
                    icon={<Trash2 aria-hidden="true" />}
                    size="icon-sm"
                    onClick={() => {
                      void removeBaseline(baseline);
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="flex items-end gap-2">
            <Field label={t('capture')} className="flex-1">
              <Input
                value={name}
                placeholder={t('namePlaceholder')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Button
              disabled={name.trim() === ''}
              onClick={() => {
                void submitCapture();
              }}
            >
              {t('capture')}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
