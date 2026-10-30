'use client';

import { Button, Field, Input, Modal, Select, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Contract } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useMembers } from '../shell/hooks';

import { useCreateContract, useUpdateContract } from './hooks';
import { CONTRACT_STATUSES } from './model';

export interface ContractDialogProps {
  workspaceId: string;
  contract?: Contract;
  onClose: () => void;
}

/** Criar/editar contrato (ADR 0054) — valores em UST e dinheiro sempre como string decimal. */
export function ContractDialog({ workspaceId, contract, onClose }: ContractDialogProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const members = useMembers();
  const create = useCreateContract(workspaceId);
  const update = useUpdateContract(workspaceId);
  const isEdit = contract !== undefined;

  const [number, setNumber] = useState(contract?.number ?? '');
  const [title, setTitle] = useState(contract?.title ?? '');
  const [clientName, setClientName] = useState(contract?.clientName ?? '');
  const [clientDocument, setClientDocument] = useState(contract?.clientDocument ?? '');
  const [object, setObject] = useState(contract?.object ?? '');
  const [seiProcess, setSeiProcess] = useState(contract?.seiProcess ?? '');
  const [biddingReference, setBiddingReference] = useState(contract?.biddingReference ?? '');
  const [startDate, setStartDate] = useState(contract?.startDate ?? '');
  const [endDate, setEndDate] = useState(contract?.endDate ?? '');
  const [ustUnitPrice, setUstUnitPrice] = useState(contract?.ustUnitPrice ?? '0');
  const [ustContracted, setUstContracted] = useState(contract?.ustContracted ?? '0');
  const [totalValue, setTotalValue] = useState(contract?.totalValue ?? '0');
  const [status, setStatus] = useState<Contract['status']>(contract?.status ?? 'active');
  const [managerId, setManagerId] = useState(contract?.managerId ?? '');
  const [notes, setNotes] = useState(contract?.notes ?? '');

  const isValid =
    number.trim() !== '' &&
    title.trim() !== '' &&
    clientName.trim() !== '' &&
    startDate !== '' &&
    endDate !== '';

  const save = async () => {
    if (!isValid) return;
    const input = {
      number: number.trim(),
      title: title.trim(),
      clientName: clientName.trim(),
      clientDocument: clientDocument.trim() === '' ? null : clientDocument.trim(),
      object: object.trim() === '' ? null : object.trim(),
      seiProcess: seiProcess.trim() === '' ? null : seiProcess.trim(),
      biddingReference: biddingReference.trim() === '' ? null : biddingReference.trim(),
      startDate,
      endDate,
      ustUnitPrice,
      ustContracted,
      totalValue,
      status,
      managerId: managerId === '' ? null : managerId,
      notes: notes.trim() === '' ? null : notes.trim(),
    };
    try {
      if (isEdit) await update.mutateAsync({ id: contract.id, input });
      else await create.mutateAsync(input);
      toast.success(isEdit ? t('dialog.updated') : t('dialog.created'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('dialog.editTitle') : t('dialog.newTitle')}
      closeLabel={tc('close')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            loading={create.isPending || update.isPending}
            disabled={!isValid}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('dialog.number')}>
            <Input value={number} onChange={(event) => { setNumber(event.target.value); }} />
          </Field>
          <Field label={t('dialog.status')}>
            <Select
              value={status}
              onValueChange={(value) => { setStatus(value as Contract['status']); }}
              options={CONTRACT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
            />
          </Field>
        </div>
        <Field label={t('dialog.title')}>
          <Input value={title} onChange={(event) => { setTitle(event.target.value); }} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('dialog.clientName')}>
            <Input value={clientName} onChange={(event) => { setClientName(event.target.value); }} />
          </Field>
          <Field label={t('dialog.clientDocument')}>
            <Input value={clientDocument} onChange={(event) => { setClientDocument(event.target.value); }} />
          </Field>
        </div>
        <Field label={t('dialog.object')}>
          <Textarea value={object} onChange={(event) => { setObject(event.target.value); }} rows={2} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('dialog.seiProcess')}>
            <Input value={seiProcess} onChange={(event) => { setSeiProcess(event.target.value); }} />
          </Field>
          <Field label={t('dialog.biddingReference')}>
            <Input value={biddingReference} onChange={(event) => { setBiddingReference(event.target.value); }} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('dialog.startDate')}>
            <Input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); }} />
          </Field>
          <Field label={t('dialog.endDate')}>
            <Input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); }} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('dialog.ustContracted')}>
            <Input
              type="number"
              min="0"
              step="0.0001"
              value={ustContracted}
              onChange={(event) => { setUstContracted(event.target.value); }}
            />
          </Field>
          <Field label={t('dialog.ustUnitPrice')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={ustUnitPrice}
              onChange={(event) => { setUstUnitPrice(event.target.value); }}
            />
          </Field>
          <Field label={t('dialog.totalValue')}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={totalValue}
              onChange={(event) => { setTotalValue(event.target.value); }}
            />
          </Field>
        </div>
        <Field label={t('dialog.manager')}>
          <Select
            value={managerId}
            onValueChange={setManagerId}
            options={[
              { value: '', label: t('dialog.noManager') },
              ...(members.data ?? []).map((member) => ({ value: member.userId, label: member.name })),
            ]}
          />
        </Field>
        <Field label={t('dialog.notes')}>
          <Textarea value={notes} onChange={(event) => { setNotes(event.target.value); }} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
