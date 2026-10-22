'use client';

import { Button, DatePicker, Field, IconButton, Input, Modal, Select, toast } from '@cube-track/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Milestone } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useCreateMilestone,
  useDeleteMilestone,
  useMilestones,
  useUpdateMilestone,
  type MilestoneInput,
} from './hooks';

export interface MilestonesDialogProps {
  boardId: string;
  canEdit: boolean;
  onClose: () => void;
}

const STATUSES: Milestone['status'][] = ['pending', 'achieved', 'missed', 'cancelled'];
const STATUS_COLOR: Record<Milestone['status'], string> = {
  pending: '#c4c4c4',
  achieved: '#00c875',
  missed: '#e2445c',
  cancelled: '#9699a6',
};

/** Marcos do board (entidades próprias, não os itens com `isMilestone`) — CRUD simples (ADR 0049). */
export function MilestonesDialog({ boardId, canEdit, onClose }: MilestonesDialogProps) {
  const t = useTranslations('gantt.milestonesDialog');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const query = useMilestones(boardId);
  const create = useCreateMilestone(boardId);
  const update = useUpdateMilestone(boardId);
  const deleteMilestone = useDeleteMilestone(boardId);

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftDate, setDraftDate] = useState<string | null>(null);

  const submitNew = async () => {
    if (draftName.trim() === '' || draftDate === null) return;
    try {
      await create.mutateAsync({ name: draftName.trim(), dueDate: draftDate });
      toast.success(t('created'));
      setDraftName('');
      setDraftDate(null);
      setAdding(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const changeStatus = async (milestone: Milestone, status: Milestone['status']) => {
    const input: Partial<MilestoneInput> = { status };
    try {
      await update.mutateAsync({ id: milestone.id, input });
      toast.success(t('updated'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeMilestone = async (milestone: Milestone) => {
    if (!window.confirm(t('deleteConfirm', { name: milestone.name }))) return;
    try {
      await deleteMilestone.mutateAsync(milestone.id);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const milestones = query.data ?? [];

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-xl"
      footer={<Button onClick={onClose}>{tc('close')}</Button>}
    >
      <div className="flex flex-col gap-3">
        {milestones.length === 0 && !query.isLoading ? (
          <p className="text-sm text-fg-muted">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {milestones.map((milestone) => (
              <li
                key={milestone.id}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[milestone.status] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{milestone.name}</span>
                <span className="shrink-0 text-xs text-fg-muted">{milestone.dueDate}</span>
                {canEdit ? (
                  <>
                    <Select
                      aria-label={t('status')}
                      value={milestone.status}
                      options={STATUSES.map((status) => ({
                        value: status,
                        label: t(`statusOptions.${status}`),
                      }))}
                      className="w-32"
                      onValueChange={(value) => {
                        void changeStatus(milestone, value as Milestone['status']);
                      }}
                    />
                    <IconButton
                      label={t('delete')}
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        void removeMilestone(milestone);
                      }}
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          adding ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
              <Field label={t('name')}>
                <Input
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                  }}
                />
              </Field>
              <Field label={t('dueDate')}>
                <DatePicker
                  value={draftDate}
                  onChange={setDraftDate}
                  label={t('dueDate')}
                  placeholder={t('dueDate')}
                  clearLabel={tc('cancel')}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAdding(false);
                  }}
                >
                  {tc('cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={draftName.trim() === '' || draftDate === null}
                  onClick={() => {
                    void submitNew();
                  }}
                >
                  {tc('save')}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setAdding(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('add')}
            </Button>
          )
        ) : null}
      </div>
    </Modal>
  );
}
