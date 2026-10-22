'use client';

import { Button, Field, Label, Modal, Select, toast } from '@cube-track/ui';
import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { BoardDetail, ScheduleImportResult, SchedulePreview } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCommitScheduleImport, usePreviewScheduleImport } from './hooks';

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}

export interface ScheduleImportDialogProps {
  board: BoardDetail;
  onClose: () => void;
}

/** Importação de cronograma MS Project (.xml) — pré-visualização, mapeamento de grupo e commit. */
export function ScheduleImportDialog({ board, onClose }: ScheduleImportDialogProps) {
  const t = useTranslations('gantt.importDialog');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const fileId = useId();
  const preview = usePreviewScheduleImport(board.id);
  const commit = useCommitScheduleImport(board.id);
  const [data, setData] = useState<SchedulePreview | null>(null);
  const [groupId, setGroupId] = useState(board.groups[0]?.id ?? '');
  const [result, setResult] = useState<ScheduleImportResult | null>(null);

  const upload = async (file: File) => {
    try {
      const response = await preview.mutateAsync({
        fileName: file.name,
        contentBase64: await toBase64(file),
      });
      setData(response);
    } catch {
      // erro já exibido via toast pelo hook
    }
  };

  const submitCommit = async () => {
    if (data === null || groupId === '') return;
    try {
      const response = await commit.mutateAsync({ importId: data.importId, groupId });
      setResult(response);
      toast.success(
        t('result', {
          created: response.created,
          skipped: response.skipped,
          dependenciesCreated: response.dependenciesCreated,
        }),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-2xl"
      footer={
        result !== null ? (
          <Button onClick={onClose}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            {data === null ? null : (
              <Button loading={commit.isPending} disabled={groupId === ''} onClick={() => void submitCommit()}>
                {t('commit')}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {result !== null ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-sm">
              {t('result', {
                created: result.created,
                skipped: result.skipped,
                dependenciesCreated: result.dependenciesCreated,
              })}
            </p>
            {result.errors.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-border p-2 text-xs">
                {result.errors.map((entry, index) => (
                  <li key={index}>
                    {entry.task}: {entry.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : data === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong p-8 text-center">
            <FileUp className="size-10 text-fg-subtle" aria-hidden="true" />
            <Label
              htmlFor={fileId}
              className="cursor-pointer text-primary underline-offset-2 hover:underline"
            >
              {preview.isPending ? t('preview') : t('chooseFile')}
            </Label>
            <input
              id={fileId}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="sr-only"
              disabled={preview.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void upload(file);
              }}
            />
          </div>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              {data.fileName} — {t('tasksFound', { count: data.totalTasks })} ·{' '}
              {t('dependenciesFound', { count: data.dependencyCount })}
            </p>
            {data.warnings.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-fg-muted">{t('warnings')}</p>
                <ul className="max-h-32 overflow-y-auto rounded-md border border-border p-2 text-xs text-fg-muted">
                  {data.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Field label={t('targetGroup')}>
              <Select
                value={groupId}
                options={board.groups.map((group) => ({ value: group.id, label: group.name }))}
                onValueChange={setGroupId}
              />
            </Field>
            <ul className="max-h-56 overflow-y-auto rounded-md border border-border text-sm">
              {data.sample.map((task, index) => (
                <li
                  key={index}
                  className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 last:border-b-0"
                >
                  {task.milestone ? <span aria-hidden="true">◆</span> : null}
                  <span className="min-w-0 flex-1 truncate">{task.name}</span>
                  {task.start !== null ? (
                    <span className="shrink-0 text-xs text-fg-muted">
                      {task.start} → {task.finish ?? '—'}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
