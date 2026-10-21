'use client';

import { Button, Field, Input, Modal, Skeleton, Switch, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardView } from '@/lib/api/types';

import {
  useRevokeShareLink,
  useShareLinkStatus,
  useUpsertShareLink,
} from './hooks';

export interface ShareLinkDialogProps {
  view: BoardView;
  onClose: () => void;
}

function toDateInputValue(iso: string | null | undefined): string {
  return iso === null || iso === undefined ? '' : iso.slice(0, 10);
}

/** Link público somente leitura da view (ADR 0047): senha, expiração e colunas ocultas opcionais. */
export function ShareLinkDialog({ view, onClose }: ShareLinkDialogProps) {
  const t = useTranslations('board.views.shareLink');
  const tc = useTranslations('common');
  const status = useShareLinkStatus(view.id, true);
  const upsert = useUpsertShareLink(view.id);
  const revoke = useRevokeShareLink(view.id);
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [allowSearch, setAllowSearch] = useState(true);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  if (!initialized && status.data !== undefined) {
    setInitialized(true);
    setExpiresAt(toDateInputValue(status.data.expiresAt));
    setAllowSearch(status.data.settings?.allowSearch ?? true);
  }

  const save = (regenerateToken: boolean) => {
    const keepsPassword = password.trim() === '' && status.data?.exists === true;
    upsert.mutate(
      {
        ...(keepsPassword ? {} : { password: password.trim() === '' ? null : password }),
        expiresAt: expiresAt === '' ? null : new Date(`${expiresAt}T23:59:59`).toISOString(),
        allowSearch,
        regenerateToken,
      },
      {
        onSuccess: (result) => {
          toast.success(t('saved'));
          if (result.token !== null) setRevealedToken(result.token);
          setPassword('');
        },
      },
    );
  };

  const shareUrl =
    revealedToken === null
      ? null
      : `${window.location.origin}/public/share/${revealedToken}`;

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-lg"
      footer={
        <>
          {status.data?.exists === true ? (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                if (!window.confirm(t('revokeConfirm'))) return;
                revoke.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(t('revoked'));
                    setRevealedToken(null);
                  },
                });
              }}
            >
              {t('revoke')}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            loading={upsert.isPending}
            onClick={() => {
              save(status.data?.exists !== true);
            }}
          >
            {status.data?.exists === true ? tc('save') : t('create')}
          </Button>
        </>
      }
    >
      {status.isPending ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="flex flex-col gap-4">
          {shareUrl !== null ? (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-sunken p-3">
              <p className="break-all font-mono text-xs">{shareUrl}</p>
              <p className="text-xs text-fg-muted">{t('tokenWarning')}</p>
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl).then(() => {
                    toast.success(t('copied'));
                  });
                }}
              >
                {t('copy')}
              </Button>
            </div>
          ) : status.data?.exists === true ? (
            <p className="text-sm text-fg-muted">
              {status.data.requiresPassword === true ? t('requiresPassword') : t('noPassword')}
              {' · '}
              {(status.data.accessCount ?? 0) === 0
                ? t('neverAccessed')
                : t('accessCount', { count: status.data.accessCount ?? 0 })}
            </p>
          ) : null}

          <Field label={t('password')} hint={t('passwordPlaceholder')}>
            <Input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </Field>
          <Field label={t('expiresAt')}>
            <Input
              type="date"
              value={expiresAt}
              onChange={(event) => {
                setExpiresAt(event.target.value);
              }}
            />
          </Field>
          <div className="flex items-center gap-2">
            <Switch id="ct-share-search" checked={allowSearch} onCheckedChange={setAllowSearch} />
            <label htmlFor="ct-share-search" className="text-sm">
              {t('allowSearch')}
            </label>
          </div>
          {view.hiddenColumnKeys.length === 0 ? null : (
            <p className="text-xs text-fg-muted">{t('hiddenColumns')}: {view.hiddenColumnKeys.join(', ')}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
