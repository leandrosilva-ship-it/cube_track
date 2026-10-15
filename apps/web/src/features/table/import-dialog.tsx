'use client';

import { isMappableTarget } from '@cube-track/shared';
import { Button, Field, Label, Modal, Select, Switch, toast } from '@cube-track/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { api, newMutationId } from '@/lib/api/client';
import type { BoardDetail, ImportPreview, ImportResult, ImportTarget } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

import { useCellLocale } from './hooks';

/** Tamanho máximo aceito pela API (10 MB). */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}

/** Importar CSV/Excel: pré-visualização no servidor, mapeamento de colunas e criação em lote. */
export function ImportDialog({ board, onClose }: { board: BoardDetail; onClose: () => void }) {
  const t = useTranslations('table.import');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const locale = useCellLocale();
  const fileId = useId();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportTarget>>({});
  const [groupId, setGroupId] = useState(board.groups[0]?.id ?? '');
  const [createMissing, setCreateMissing] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = [
    { value: 'ignore', label: t('ignore') },
    { value: 'name', label: t('itemName') },
    { value: 'group', label: t('group') },
    ...board.columns
      .filter((column) => column.canEdit && isMappableTarget(column))
      .map((column) => ({ value: `column:${column.key}`, label: column.title })),
  ];

  const upload = async (file: File) => {
    setError(null);
    if (file.size > IMPORT_MAX_BYTES) {
      setError(t('tooLarge'));
      return;
    }
    setBusy(true);
    try {
      const response = await api<ImportPreview>(`/v1/boards/${board.id}/imports`, {
        method: 'POST',
        body: { fileName: file.name, contentBase64: await toBase64(file) },
      });
      setPreview(response);
      setMapping(response.suggestedMapping);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (preview === null) return;
    if (!Object.values(mapping).includes('name')) {
      setError(t('nameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api<ImportResult>(
        `/v1/boards/${board.id}/imports/${preview.importId}/commit`,
        {
          method: 'POST',
          body: { mapping, groupId, createMissing, locale },
          idempotencyKey: newMutationId(),
        },
      );
      setResult(response);
      void queryClient.invalidateQueries({ queryKey: qk.board(board.id) });
      toast.success(t('done', { count: response.created }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-3xl"
      footer={
        result !== null ? (
          <Button onClick={onClose}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {tc('cancel')}
            </Button>
            {preview === null ? null : (
              <Button loading={busy} onClick={() => void commit()}>
                {t('importRows', { count: preview.totalRows })}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error === null ? null : (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {result !== null ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-sm">
              {t('summary', { created: result.created, skipped: result.skipped })}
            </p>
            {result.errors.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-border p-2 text-xs">
                {result.errors.map((entry, index) => (
                  <li key={index}>
                    {t('rowError', {
                      row: entry.row,
                      column: entry.column ?? '—',
                      message: entry.message,
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : preview === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong p-8 text-center">
            <FileSpreadsheet className="size-10 text-fg-subtle" aria-hidden="true" />
            <Label
              htmlFor={fileId}
              className="cursor-pointer text-primary underline-offset-2 hover:underline"
            >
              {busy ? t('reading') : t('choose')}
            </Label>
            <input
              id={fileId}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file !== undefined) void upload(file);
              }}
            />
            <p className="text-xs text-fg-muted">{t('limits')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-fg-muted">
              {t('rows', { file: preview.fileName, count: preview.totalRows })}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('targetGroup')}>
                <Select
                  value={groupId}
                  options={board.groups.map((group) => ({ value: group.id, label: group.name }))}
                  onValueChange={setGroupId}
                />
              </Field>
              <div className="flex items-center gap-2 pt-6">
                <Switch
                  id="ct-create-missing"
                  checked={createMissing}
                  onCheckedChange={setCreateMissing}
                />
                <Label htmlFor="ct-create-missing">{t('createMissing')}</Label>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('mappingCaption')}</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-sunken text-start">
                    <th scope="col" className="px-2 py-1.5 text-start">
                      {t('sourceColumn')}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-start">
                      {t('target')}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-start">
                      {t('sample')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((header, index) => (
                    <tr
                      key={`${header}-${String(index)}`}
                      className="border-b border-border last:border-b-0"
                    >
                      <th scope="row" className="px-2 py-1.5 text-start font-medium">
                        {header}
                      </th>
                      <td className="px-2 py-1.5">
                        <Select
                          className="h-8"
                          aria-label={t('targetFor', { column: header })}
                          value={mapping[header] ?? 'ignore'}
                          options={targets}
                          onValueChange={(value) => {
                            setMapping((current) => ({
                              ...current,
                              [header]: value === 'ignore' ? null : (value as ImportTarget),
                            }));
                          }}
                        />
                      </td>
                      <td className="max-w-48 truncate px-2 py-1.5 text-fg-muted">
                        {preview.sample
                          .slice(0, 3)
                          .map((row) => row[index] ?? '')
                          .filter((cell) => cell !== '')
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
