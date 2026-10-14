'use client';

import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  Kbd,
  Modal,
  Select,
  toast,
} from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { useRouter } from '@/i18n/navigation';
import type { BoardKind, BoardVisibility } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { closeDialog, useShell, type ShellDialog } from '@/stores/shell';
import { updatePreferences } from '@/stores/preferences';

import {
  useCreateBoard,
  useCreateFolder,
  useCreateWorkspace,
  useRenameNode,
  useTree,
} from '../workspace/hooks';
import { SHORTCUTS } from './shortcuts';

function FormModal({
  title,
  description,
  submitLabel,
  submitting,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  submitting: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const tc = useTranslations('common');
  const handle = (event: SubmitEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <Modal
      title={title}
      {...(description === undefined ? {} : { description })}
      closeLabel={tc('close')}
    >
      <form onSubmit={handle} className="flex flex-col gap-4">
        {children}
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="ghost">{tc('cancel')}</Button>
          </DialogClose>
          <Button type="submit" loading={submitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NameField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  label?: string;
}) {
  const tc = useTranslations('common');
  return (
    <Field label={label ?? tc('name')} error={error} required requiredLabel={tc('required')}>
      <Input
        value={value}
        maxLength={120}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        // Foco inicial no campo principal do diálogo.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
    </Field>
  );
}

function NewWorkspaceDialog() {
  const t = useTranslations('dialogs.newWorkspace');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={t('title')}
      description={t('description')}
      submitLabel={tc('create')}
      submitting={create.isPending}
      onSubmit={() => {
        if (name.trim() === '') {
          setError(tv('required'));
          return;
        }
        create.mutate(
          { name: name.trim() },
          {
            onSuccess: (workspace) => {
              closeDialog();
              updatePreferences({ lastWorkspaceId: workspace.id });
              router.push(`/w/${workspace.id}`);
            },
            onError: (caught) => {
              setError(errorMessage(caught));
            },
          },
        );
      }}
    >
      <NameField value={name} onChange={setName} error={error} />
    </FormModal>
  );
}

function NewFolderDialog({ dialog }: { dialog: Extract<ShellDialog, { type: 'newFolder' }> }) {
  const t = useTranslations('dialogs.newFolder');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const create = useCreateFolder(dialog.workspaceId);
  const tree = useTree(dialog.workspaceId);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(dialog.parentId ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={t('title')}
      submitLabel={tc('create')}
      submitting={create.isPending}
      onSubmit={() => {
        if (name.trim() === '') {
          setError(tv('required'));
          return;
        }
        create.mutate(
          { name: name.trim(), parentId: parentId === '' ? null : parentId },
          {
            onSuccess: closeDialog,
            onError: (caught) => {
              setError(errorMessage(caught));
            },
          },
        );
      }}
    >
      <NameField value={name} onChange={setName} error={error} />
      <Field label={t('parent')}>
        <Select
          value={parentId === '' ? 'root' : parentId}
          onValueChange={(value) => {
            setParentId(value === 'root' ? '' : value);
          }}
          options={[
            { value: 'root', label: t('root') },
            ...(tree.data?.folders ?? []).map((folder) => ({
              value: folder.id,
              label: folder.name,
            })),
          ]}
        />
      </Field>
    </FormModal>
  );
}

function NewBoardDialog({ dialog }: { dialog: Extract<ShellDialog, { type: 'newBoard' }> }) {
  const t = useTranslations('dialogs.newBoard');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const tf = useTranslations('dialogs.newFolder');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const create = useCreateBoard(dialog.workspaceId);
  const tree = useTree(dialog.workspaceId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BoardKind>('board');
  const [visibility, setVisibility] = useState<BoardVisibility>('main');
  const [folderId, setFolderId] = useState(dialog.folderId ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={t('title')}
      submitLabel={tc('create')}
      submitting={create.isPending}
      onSubmit={() => {
        if (name.trim() === '') {
          setError(tv('required'));
          return;
        }
        create.mutate(
          { name: name.trim(), kind, visibility, folderId: folderId === '' ? null : folderId },
          {
            onSuccess: (board) => {
              closeDialog();
              toast.success(t('created', { name: board.name }));
              router.push(`/w/${dialog.workspaceId}/b/${board.id}`);
            },
            onError: (caught) => {
              setError(errorMessage(caught));
            },
          },
        );
      }}
    >
      <NameField value={name} onChange={setName} error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('kind')}>
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value as BoardKind);
            }}
            options={(['board', 'project', 'process', 'backlog'] as const).map((value) => ({
              value,
              label: t(`kinds.${value}`),
            }))}
          />
        </Field>
        <Field label={t('folder')}>
          <Select
            value={folderId === '' ? 'root' : folderId}
            onValueChange={(value) => {
              setFolderId(value === 'root' ? '' : value);
            }}
            options={[
              { value: 'root', label: tf('root') },
              ...(tree.data?.folders ?? []).map((folder) => ({
                value: folder.id,
                label: folder.name,
              })),
            ]}
          />
        </Field>
      </div>
      <Field label={t('visibility')}>
        <Select
          value={visibility}
          onValueChange={(value) => {
            setVisibility(value as BoardVisibility);
          }}
          options={(['main', 'private', 'shareable'] as const).map((value) => ({
            value,
            label: t(`visibilities.${value}`),
          }))}
        />
      </Field>
    </FormModal>
  );
}

function RenameDialog({ dialog }: { dialog: Extract<ShellDialog, { type: 'rename' }> }) {
  const t = useTranslations('dialogs.rename');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const rename = useRenameNode(dialog.workspaceId);
  const [name, setName] = useState(dialog.name);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormModal
      title={t('title', { name: dialog.name })}
      submitLabel={tc('save')}
      submitting={rename.isPending}
      onSubmit={() => {
        if (name.trim() === '') {
          setError(tv('required'));
          return;
        }
        rename.mutate(
          { type: dialog.node, id: dialog.id, name: name.trim() },
          {
            onSuccess: closeDialog,
            onError: (caught) => {
              setError(errorMessage(caught));
            },
          },
        );
      }}
    >
      <NameField value={name} onChange={setName} error={error} />
    </FormModal>
  );
}

function ShortcutsDialog() {
  const t = useTranslations('shortcuts');
  const tc = useTranslations('common');
  const groups = ['global', 'navigation', 'board'] as const;
  return (
    <Modal title={t('title')} description={t('description')} closeLabel={tc('close')}>
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group} aria-labelledby={`shortcuts-${group}`}>
            <h3
              id={`shortcuts-${group}`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle"
            >
              {t(`groups.${group}`)}
            </h3>
            <dl className="flex flex-col gap-1.5">
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.id} className="flex items-center justify-between gap-4 text-sm">
                  <dt>{t(shortcut.label)}</dt>
                  <dd className="flex items-center gap-1">
                    {shortcut.keys.map((key, index) => (
                      <span
                        key={`${shortcut.id}-${String(index)}`}
                        className="flex items-center gap-1"
                      >
                        {index > 0 && shortcut.sequence ? (
                          <span className="text-xs text-fg-subtle">{t('then')}</span>
                        ) : null}
                        <Kbd>{key}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}

/** Diálogos globais do shell, controlados pelo store (abrem a partir de menus, paleta e atalhos). */
export function ShellDialogs() {
  const dialog = useShell((state) => state.dialog);
  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      {dialog?.type === 'newWorkspace' ? <NewWorkspaceDialog /> : null}
      {dialog?.type === 'newFolder' ? (
        <NewFolderDialog key={dialog.workspaceId} dialog={dialog} />
      ) : null}
      {dialog?.type === 'newBoard' ? (
        <NewBoardDialog key={dialog.workspaceId} dialog={dialog} />
      ) : null}
      {dialog?.type === 'rename' ? <RenameDialog key={dialog.id} dialog={dialog} /> : null}
      {dialog?.type === 'shortcuts' ? <ShortcutsDialog /> : null}
    </Dialog>
  );
}
