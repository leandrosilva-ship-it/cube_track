'use client';

import { formatRelativeTime } from '@cube-track/i18n';
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Modal,
  Skeleton,
  cn,
} from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  File as FileIcon,
  FileImage,
  History,
  MoreHorizontal,
  Paperclip,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { api } from '@/lib/api/client';
import type { AttachmentSummary, AttachmentVersion, BoardDetail, Item } from '@/lib/api/types';

import {
  useDeleteFile,
  useDownloadFile,
  useFileVersions,
  useItemFiles,
  useUploadFile,
} from './hooks';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

const PREVIEWABLE_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Aba "Arquivos": upload por arraste, pré-visualização (imagem/PDF), versões e exclusão. */
export function FilesTab({
  board,
  item,
  canManage,
}: {
  board: BoardDetail;
  item: Item;
  canManage: boolean;
}) {
  const t = useTranslations('itemPanel');
  const files = useItemFiles(item.id);
  const upload = useUploadFile(item.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<AttachmentSummary | null>(null);
  const [versionsOf, setVersionsOf] = useState<AttachmentSummary | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (fileList === null || fileList.length === 0) return;
    setUploading(true);
    for (const file of Array.from(fileList)) {
      await upload({ boardId: board.id, itemId: item.id }, file);
    }
    setUploading(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Zona de soltar arquivos é só reforço visual; o botão "Escolher arquivos" abaixo já cobre teclado/mouse/touch. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => {
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-fg-muted',
          dragOver && 'border-primary bg-primary-soft',
        )}
      >
        <UploadCloud className="size-6" aria-hidden="true" />
        <p>{t('files.dropHint')}</p>
        <Button
          size="sm"
          variant="subtle"
          disabled={uploading}
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          {uploading ? t('files.uploading') : t('files.browse')}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          aria-label={t('files.browse')}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      {files.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (files.data ?? []).length === 0 ? (
        <EmptyState icon={<Paperclip aria-hidden="true" />} title={t('files.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {(files.data ?? []).map((file) => (
            <FileRow
              key={file.id}
              boardId={board.id}
              itemId={item.id}
              file={file}
              canManage={canManage}
              onPreview={() => {
                setPreview(file);
              }}
              onVersions={() => {
                setVersionsOf(file);
              }}
            />
          ))}
        </ul>
      )}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        {preview === null ? null : <PreviewDialog file={preview} />}
      </Dialog>
      <Dialog
        open={versionsOf !== null}
        onOpenChange={(open) => {
          if (!open) setVersionsOf(null);
        }}
      >
        {versionsOf === null ? null : (
          <VersionsDialog boardId={board.id} itemId={item.id} file={versionsOf} canManage={canManage} />
        )}
      </Dialog>
    </div>
  );
}

function FileRow({
  itemId,
  file,
  canManage,
  onPreview,
  onVersions,
}: {
  boardId: string;
  itemId: string;
  file: AttachmentSummary;
  canManage: boolean;
  onPreview: () => void;
  onVersions: () => void;
}) {
  const t = useTranslations('itemPanel');
  const locale = useLocale();
  const download = useDownloadFile();
  const remove = useDeleteFile(itemId);
  const previewable = PREVIEWABLE_IMAGE.has(file.mimeType) || file.mimeType === 'application/pdf';
  const Icon = PREVIEWABLE_IMAGE.has(file.mimeType) ? FileImage : FileIcon;

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Icon className="size-5 shrink-0 text-fg-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="truncate text-start text-sm font-medium hover:underline"
          onClick={() => {
            if (previewable && file.scanStatus === 'clean') onPreview();
            else void download(file.id);
          }}
        >
          {file.fileName}
        </button>
        <p className="text-xs text-fg-subtle">
          {formatBytes(file.sizeBytes)} · {formatRelativeTime(file.createdAt, locale)}
          {file.currentVersion > 1 ? ` · v${String(file.currentVersion)}` : ''}
          {file.scanStatus === 'pending' ? ` · ${t('files.scanning')}` : ''}
          {file.scanStatus === 'infected' || file.scanStatus === 'error' ? ` · ${t('files.blocked')}` : ''}
        </p>
      </div>
      <IconButton
        label={t('files.download')}
        icon={<Download aria-hidden="true" />}
        size="icon-sm"
        variant="ghost"
        disabled={file.scanStatus !== 'clean'}
        onClick={() => {
          void download(file.id);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={t('menu')} icon={<MoreHorizontal aria-hidden="true" />} size="icon-sm" variant="ghost" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<History aria-hidden="true" />} onSelect={onVersions}>
            {t('files.versions')}
          </DropdownMenuItem>
          {canManage ? (
            <DropdownMenuItem
              destructive
              icon={<Trash2 aria-hidden="true" />}
              onSelect={() => {
                void remove(file.id);
              }}
            >
              {t('delete')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function PreviewDialog({ file }: { file: AttachmentSummary }) {
  const t = useTranslations('itemPanel');
  const url = useQuery({
    queryKey: ['file-preview-url', file.id],
    queryFn: () => api<{ url: string }>(`/v1/files/${file.id}/download-url`).then((r) => r.url),
  });
  return (
    <Modal title={file.fileName} closeLabel={t('close')} className="max-w-3xl">
      {url.isPending ? (
        <Skeleton className="h-96" />
      ) : url.data === undefined ? (
        <p className="text-sm text-fg-muted">{t('files.previewUnavailable')}</p>
      ) : PREVIEWABLE_IMAGE.has(file.mimeType) ? (
        <img src={url.data} alt={file.fileName} className="mx-auto max-h-[70vh] max-w-full rounded-md" />
      ) : (
        <iframe title={file.fileName} src={url.data} className="h-[70vh] w-full rounded-md border border-border" />
      )}
    </Modal>
  );
}

function VersionsDialog({
  boardId,
  itemId,
  file,
  canManage,
}: {
  boardId: string;
  itemId: string;
  file: AttachmentSummary;
  canManage: boolean;
}) {
  const t = useTranslations('itemPanel');
  const locale = useLocale();
  const versions = useFileVersions(file.id, true);
  const download = useDownloadFile();
  const upload = useUploadFile(itemId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  return (
    <Modal title={t('files.versionsOf', { name: file.fileName })} closeLabel={t('close')}>
      <div className="flex flex-col gap-3">
        {versions.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {(versions.data ?? []).map((version: AttachmentVersion) => (
              <li key={version.version} className="flex items-center gap-2 py-2 text-sm">
                <span className="font-medium">v{version.version}</span>
                {version.isCurrent ? <span className="text-xs text-primary">{t('files.current')}</span> : null}
                <span className="text-xs text-fg-subtle">
                  {formatBytes(version.sizeBytes)} · {formatRelativeTime(version.createdAt, locale)}
                </span>
                <IconButton
                  label={t('files.download')}
                  icon={<Download aria-hidden="true" />}
                  size="icon-sm"
                  variant="ghost"
                  className="ms-auto"
                  disabled={version.scanStatus !== 'clean'}
                  onClick={() => {
                    void download(file.id, version.version);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <>
            <Button
              size="sm"
              variant="subtle"
              disabled={uploading}
              onClick={() => {
                inputRef.current?.click();
              }}
            >
              {t('files.uploadNewVersion')}
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label={t('files.uploadNewVersion')}
              onChange={(event) => {
                const next = event.target.files?.[0];
                event.target.value = '';
                if (next === undefined) return;
                setUploading(true);
                void upload({ boardId, itemId, attachmentId: file.id }, next).finally(() => {
                  setUploading(false);
                });
              }}
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
