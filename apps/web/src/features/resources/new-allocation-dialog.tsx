'use client';

import { Button, DatePicker, Field, Input, Modal, Select, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMembers } from '../shell/hooks';
import { useTableItems } from '../table/hooks';
import type { BoardDetail } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateAllocation } from './hooks';

const EMPTY_PARAMS = {};

export interface NewAllocationDialogProps {
  board: BoardDetail;
  onClose: () => void;
}

/**
 * Aloca uma pessoa a um item do board, em horas/dia, por um período (ADR 0052) — é a ação de
 * "atribuir um item" que o critério de aceite de sobrealocação em tempo real depende: ao salvar,
 * o heatmap de quem está assistindo (outra aba/pessoa) atualiza via `allocation.changed`.
 */
export function NewAllocationDialog({ board, onClose }: NewAllocationDialogProps) {
  const t = useTranslations('capacity');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const members = useMembers();
  const items = useTableItems(board, EMPTY_PARAMS);
  const create = useCreateAllocation();

  const today = new Date().toISOString().slice(0, 10);
  const [userId, setUserId] = useState('');
  const [itemId, setItemId] = useState('');
  const [startDate, setStartDate] = useState<string | null>(today);
  const [endDate, setEndDate] = useState<string | null>(today);
  const [hoursPerDay, setHoursPerDay] = useState('8');

  const save = async () => {
    if (userId === '' || startDate === null || endDate === null) return;
    try {
      await create.mutateAsync({
        userId,
        boardId: board.id,
        itemId: itemId === '' ? null : itemId,
        startDate,
        endDate,
        hoursPerDay,
        status: 'confirmed',
      });
      toast.success(t('allocations.created'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('allocations.newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            loading={create.isPending}
            disabled={userId === '' || startDate === null || endDate === null}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('allocations.person')}>
          <Select
            value={userId}
            onValueChange={setUserId}
            options={(members.data ?? []).map((member) => ({ value: member.userId, label: member.name }))}
            placeholder={t('allocations.person')}
          />
        </Field>
        <Field label={t('allocations.item')}>
          <Select
            value={itemId}
            onValueChange={setItemId}
            options={[
              { value: '', label: t('allocations.noItem') },
              ...items.items.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('whatIf.start')}>
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              label={t('whatIf.start')}
              placeholder={t('whatIf.start')}
              clearLabel={t('absences.clear')}
            />
          </Field>
          <Field label={t('whatIf.end')}>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              label={t('whatIf.end')}
              placeholder={t('whatIf.end')}
              clearLabel={t('absences.clear')}
            />
          </Field>
        </div>
        <Field label={t('allocations.hoursPerDay')}>
          <Input
            type="number"
            min={0}
            max={24}
            value={hoursPerDay}
            onChange={(event) => {
              setHoursPerDay(event.target.value);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}
