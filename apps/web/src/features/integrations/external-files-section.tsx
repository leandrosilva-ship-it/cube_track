'use client';

import { Button, Field, IconButton, Input, Skeleton, toast } from '@cube-track/ui';
import { ExternalLink, Link2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useExternalFiles, useLinkExternalFile, useUnlinkExternalFile } from './hooks';

/**
 * Arquivos do Google Drive/OneDrive vinculados por REFERÊNCIA (ADR 0056) — nunca baixados/reenviados
 * ao storage próprio, claramente distintos de um anexo real (ícone/rótulo "Link externo").
 *
 * Simplificação documentada: não há um seletor de arquivo (picker) do Drive/OneDrive nesta entrega —
 * a pessoa cola o id (ou link, de onde extraímos o id) da conexão e do arquivo. Honesto dentro do
 * escopo: o backend resolve nome/ícone/link reais a partir desses ids via `fetchFileMetadata`.
 */
export function ExternalFilesSection({ itemId, canManage }: { itemId: string; canManage: boolean }) {
  const t = useTranslations('integrations');
  const errorMessage = useErrorMessage();
  const files = useExternalFiles(itemId);
  const link = useLinkExternalFile(itemId);
  const unlink = useUnlinkExternalFile(itemId);
  const [showForm, setShowForm] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [externalFileId, setExternalFileId] = useState('');

  const submit = async () => {
    if (connectionId.trim() === '' || externalFileId.trim() === '') {
      toast.error(t('externalFiles.incomplete'));
      return;
    }
    try {
      await link.mutateAsync({ connectionId: connectionId.trim(), externalFileId: externalFileId.trim() });
      setConnectionId('');
      setExternalFileId('');
      setShowForm(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Link2 className="size-4 text-primary" aria-hidden="true" />
          {t('externalFiles.title')}
        </h3>
        {canManage ? (
          <Button size="sm" variant="ghost" onClick={() => { setShowForm((current) => !current); }}>
            <Plus aria-hidden="true" />
            {t('externalFiles.add')}
          </Button>
        ) : null}
      </div>
      {files.isPending ? (
        <Skeleton className="h-8" />
      ) : (files.data ?? []).length === 0 && !showForm ? null : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {(files.data ?? []).map((file) => (
            <li key={file.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <ExternalLink className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
              <a href={file.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">
                {file.name}
              </a>
              <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-fg-subtle">
                {t('externalFiles.externalBadge')}
              </span>
              {canManage ? (
                <IconButton
                  label={t('externalFiles.remove')}
                  icon={<Trash2 aria-hidden="true" />}
                  size="icon-sm"
                  onClick={() => {
                    unlink.mutate(file.id, { onError: (error) => { toast.error(errorMessage(error)); } });
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage && showForm ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-fg-muted">{t('externalFiles.hint')}</p>
          <Field label={t('externalFiles.connectionIdLabel')}>
            <Input value={connectionId} onChange={(event) => { setConnectionId(event.target.value); }} />
          </Field>
          <Field label={t('externalFiles.fileIdLabel')}>
            <Input value={externalFileId} onChange={(event) => { setExternalFileId(event.target.value); }} />
          </Field>
          <Button size="sm" loading={link.isPending} className="self-start" onClick={() => void submit()}>
            {t('externalFiles.submit')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
