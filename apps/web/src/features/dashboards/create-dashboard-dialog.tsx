'use client';

import { Button, Field, Input, Modal, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useWorkspaceBoards } from '../table/hooks';
import { useCreateDashboard } from './hooks';

export interface CreateDashboardDialogProps {
  workspaceId: string;
  onCreated: (dashboardId: string) => void;
}

/** Diálogo de criação de um dashboard standalone (fora de um board): nome + boards-fonte. */
export function CreateDashboardDialog({ workspaceId, onCreated }: CreateDashboardDialogProps) {
  const t = useTranslations('dashboards');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const boardsQuery = useWorkspaceBoards(workspaceId, true);
  const create = useCreateDashboard(workspaceId);
  const [name, setName] = useState('');
  const [sourceBoardIds, setSourceBoardIds] = useState<string[]>([]);

  const submit = async () => {
    if (name.trim() === '' || sourceBoardIds.length === 0) {
      toast.error(t('widgetDialog.incomplete'));
      return;
    }
    try {
      const created = await create.mutateAsync({ name: name.trim(), sourceBoardIds });
      onCreated(created.id);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('create')}
      closeLabel={tc('close')}
      footer={
        <Button
          loading={create.isPending}
          onClick={() => {
            void submit();
          }}
        >
          {tc('create')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('widgetDialog.title')}>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label={t('sourceBoards')}>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
            {(boardsQuery.data ?? []).map((board) => (
              <li key={board.id}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sourceBoardIds.includes(board.id)}
                    onChange={(event) => {
                      setSourceBoardIds((current) =>
                        event.target.checked
                          ? [...current, board.id]
                          : current.filter((id) => id !== board.id),
                      );
                    }}
                  />
                  {board.name}
                </label>
              </li>
            ))}
          </ul>
        </Field>
      </div>
    </Modal>
  );
}
