'use client';

import { isMappableTarget, IMPORT_SOURCES, type ImportSource } from '@cube-track/shared';
import { Button, EmptyState, Field, Modal, Select, Skeleton, Spinner, toast } from '@cube-track/ui';
import { CheckCircle2, FileWarning, Upload, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { BoardDetail, ImportMapping, ImportPreviewResponse } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCommitImport, useImportJob, usePreviewImport, useUpdateImportMapping } from './hooks';
import { hasNameMapping, selectValueToTarget, targetToSelectValue } from './model';

/** Tamanho máximo aceito pela API (`PreviewBody.contentBase64`, ~10 MB em binário). */
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}

const SOURCE_ACCEPT: Record<ImportSource, string> = {
  csv: '.csv,.tsv,.txt,text/csv',
  monday: '.csv,.tsv,.txt,text/csv',
  jira: '.csv,.tsv,.txt,text/csv',
  pipefy: '.csv,.tsv,.txt,text/csv',
  trello: '.json,application/json',
};

type Step = 'source' | 'upload' | 'mapping' | 'progress';

/**
 * Importação em background (ADR 0056): Monday/Trello/Jira/Pipefy/CSV, com progresso acompanhado no
 * worker — complementa o importador síncrono de CSV/Excel do Prompt 5 (`features/table/import-dialog.tsx`,
 * que continua existindo para uploads pequenos e imediatos).
 */
export function ImportWizardDialog({ board, onDone }: { board: BoardDetail; onDone: () => void }) {
  const t = useTranslations('imports');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const fileId = useId();

  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<ImportSource>('csv');
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [importJobId, setImportJobId] = useState<string | null>(null);

  const previewMutation = usePreviewImport(board.id);
  const updateMapping = useUpdateImportMapping();
  const commit = useCommitImport();
  const job = useImportJob(importJobId);

  const targets = [
    { value: 'ignore', label: t('mapping.ignore') },
    { value: 'name', label: t('mapping.name') },
    { value: 'group', label: t('mapping.group') },
    ...board.columns.filter((column) => column.canEdit && isMappableTarget(column)).map((column) => ({
      value: `column:${column.key}`,
      label: column.title,
    })),
  ];

  const upload = async (file: File) => {
    if (file.size > IMPORT_MAX_BYTES) {
      toast.error(t('upload.tooLarge'));
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const response = await previewMutation.mutateAsync({ source, fileName: file.name, contentBase64 });
      setPreview(response);
      setMapping(response.suggestedMapping);
      setImportJobId(response.importJobId);
      setStep('mapping');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const confirmMapping = async () => {
    if (importJobId === null) return;
    if (!hasNameMapping(mapping)) {
      toast.error(t('mapping.nameRequired'));
      return;
    }
    try {
      await updateMapping.mutateAsync({ importJobId, mapping });
      await commit.mutateAsync(importJobId);
      setStep('progress');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-3xl"
      footer={
        step === 'source' ? (
          <Button
            onClick={() => {
              setStep('upload');
            }}
          >
            {t('next')}
          </Button>
        ) : step === 'upload' ? (
          <Button variant="ghost" onClick={() => { setStep('source'); }}>
            {tc('back')}
          </Button>
        ) : step === 'mapping' ? (
          <>
            <Button variant="ghost" onClick={() => { setStep('upload'); }}>
              {tc('back')}
            </Button>
            <Button loading={updateMapping.isPending || commit.isPending} onClick={() => void confirmMapping()}>
              {t('mapping.confirm', { count: preview?.totalRows ?? 0 })}
            </Button>
          </>
        ) : (
          <Button onClick={onDone} disabled={job.data?.status === 'uploaded' || job.data?.status === 'processing'}>
            {tc('close')}
          </Button>
        )
      }
    >
      {step === 'source' ? (
        <div className="flex flex-col gap-3">
          <Field label={t('source.label')}>
            <Select
              value={source}
              options={IMPORT_SOURCES.map((value) => ({ value, label: t(`source.${value}.label`) }))}
              onValueChange={(value) => { setSource(value as ImportSource); }}
            />
          </Field>
          <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-fg-muted">{t(`source.${source}.hint`)}</p>
        </div>
      ) : null}

      {step === 'upload' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong p-8 text-center">
          <Upload className="size-10 text-fg-subtle" aria-hidden="true" />
          <label htmlFor={fileId} className="cursor-pointer text-primary underline-offset-2 hover:underline">
            {previewMutation.isPending ? t('upload.reading') : t('upload.choose')}
          </label>
          <input
            id={fileId}
            type="file"
            accept={SOURCE_ACCEPT[source]}
            className="sr-only"
            disabled={previewMutation.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) void upload(file);
            }}
          />
          <p className="text-xs text-fg-muted">{t('upload.limits')}</p>
        </div>
      ) : null}

      {step === 'mapping' && preview !== null ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">{t('mapping.rowsCount', { count: preview.totalRows })}</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('mapping.caption')}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-start">
                  <th scope="col" className="px-2 py-1.5 text-start">{t('mapping.sourceColumn')}</th>
                  <th scope="col" className="px-2 py-1.5 text-start">{t('mapping.sample')}</th>
                  <th scope="col" className="px-2 py-1.5 text-start">{t('mapping.target')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.headers.map((header, index) => {
                  const key = String(index);
                  const target = mapping[key] ?? { type: 'ignore' as const };
                  return (
                    <tr key={`${header}-${key}`} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-2 py-1.5 text-start font-medium">{header}</th>
                      <td className="max-w-48 truncate px-2 py-1.5 text-fg-muted">
                        {preview.sample
                          .slice(0, 3)
                          .map((row) => row[index] ?? '')
                          .filter((cell) => cell !== '')
                          .join(' · ')}
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          className="h-8"
                          aria-label={t('mapping.targetFor', { column: header })}
                          value={targetToSelectValue(target)}
                          options={targets}
                          onValueChange={(value) => {
                            setMapping((current) => ({ ...current, [key]: selectValueToTarget(value) }));
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {step === 'progress' ? <ProgressStep jobId={importJobId} /> : null}
    </Modal>
  );
}

function ProgressStep({ jobId }: { jobId: string | null }) {
  const t = useTranslations('imports');
  const job = useImportJob(jobId);

  if (job.data === undefined) return <Skeleton className="h-32" />;

  if (job.data.status === 'uploaded' || job.data.status === 'processing') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center" role="status">
        <Spinner size="lg" label={t('progress.processing')} />
        <p className="text-sm text-fg-muted">{t('progress.processing')}</p>
      </div>
    );
  }

  if (job.data.status === 'failed') {
    return (
      <EmptyState
        icon={<XCircle aria-hidden="true" className="text-danger" />}
        title={t('progress.failedTitle')}
        description={t('progress.failedDescription')}
      />
    );
  }

  const errors = job.data.errorReport ?? [];
  return (
    <div className="flex flex-col gap-3" role="status">
      <div className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
        <CheckCircle2 className="size-5" aria-hidden="true" />
        {t('progress.summary', { created: job.data.createdCount ?? 0, skipped: job.data.skippedCount ?? 0 })}
      </div>
      {errors.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <FileWarning className="size-4" aria-hidden="true" />
            {t('progress.errorsTitle')}
          </p>
          <ul className="max-h-48 overflow-y-auto rounded-md border border-border p-2 text-xs">
            {errors.map((entry, index) => (
              <li key={index}>{t('progress.rowError', { row: entry.row, message: entry.message })}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
