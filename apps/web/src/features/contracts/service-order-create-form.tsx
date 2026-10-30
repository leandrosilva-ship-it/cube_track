'use client';

import { Button, Field, Input, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { CreateServiceOrderInput, ServiceOrder } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

export interface ServiceOrderCreateFormProps {
  onSubmit: (input: CreateServiceOrderInput) => Promise<ServiceOrder>;
  pending: boolean;
  onCreated: (order: ServiceOrder) => void;
  onCancel?: () => void;
}

/**
 * Formulário de criação de uma OS (ADR 0054) — reutilizado tanto para a OS avulsa de um board
 * (`ServiceOrdersDialog`) quanto para a OS vinculada a um item (aba "OS/UST" do Painel do Item).
 * O número é obrigatório (único por contrato, validado pelo backend); os demais campos são livres.
 */
export function ServiceOrderCreateForm({ onSubmit, pending, onCreated, onCancel }: ServiceOrderCreateFormProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [number, setNumber] = useState('');
  const [seiProcess, setSeiProcess] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [description, setDescription] = useState('');

  const submit = async () => {
    if (number.trim() === '') return;
    try {
      const order = await onSubmit({
        number: number.trim(),
        seiProcess: seiProcess.trim() === '' ? null : seiProcess.trim(),
        requesterName: requesterName.trim() === '' ? null : requesterName.trim(),
        description: description.trim() === '' ? null : description.trim(),
      });
      toast.success(t('serviceOrders.created'));
      onCreated(order);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('serviceOrders.number')} required requiredLabel={tc('required')}>
        <Input
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
          }}
        />
      </Field>
      <Field label={t('serviceOrders.seiProcess')}>
        <Input
          value={seiProcess}
          onChange={(event) => {
            setSeiProcess(event.target.value);
          }}
        />
      </Field>
      <Field label={t('serviceOrders.requesterName')}>
        <Input
          value={requesterName}
          onChange={(event) => {
            setRequesterName(event.target.value);
          }}
        />
      </Field>
      <Field label={t('serviceOrders.description')}>
        <Textarea
          value={description}
          rows={2}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {tc('cancel')}
          </Button>
        )}
        <Button size="sm" onClick={() => void submit()} loading={pending} disabled={number.trim() === ''}>
          {tc('create')}
        </Button>
      </div>
    </div>
  );
}
