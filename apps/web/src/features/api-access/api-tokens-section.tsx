'use client';

import { formatDateTime } from '@cube-track/i18n';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Skeleton,
  toast,
} from '@cube-track/ui';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ApiTokenWithSecret } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateMyApiToken, useMyApiTokens, useRevokeMyApiToken } from './hooks';
import { API_SCOPES, endOfDayIso, isExpired, toggleScope } from './model';

type ApiAccessTranslator = ReturnType<typeof useTranslations<'apiAccess'>>;

/** Mapa escopo → rótulo traduzido: evita `t(`scope.${scope}`)` com uma `scope: string` solta (o
 * array tipado `API_SCOPES` tem literais; `token.scopes`/`app.scopes`, vindos da API, não). */
function scopeLabels(t: ApiAccessTranslator): Record<string, string> {
  return Object.fromEntries(API_SCOPES.map((scope) => [scope, t(`scope.${scope}`)]));
}

/**
 * Autosserviço de tokens de API pessoais (ADR 0056) — sem permissão especial, visível para qualquer
 * usuário autenticado (mesmo espírito de trocar a própria senha ou configurar MFA).
 */
export function ApiTokensSection() {
  const [showCreate, setShowCreate] = useState(false);
  const [revealed, setRevealed] = useState<ApiTokenWithSecret | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <TokenList
        onCreate={() => {
          setShowCreate(true);
        }}
      />
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) setShowCreate(false);
        }}
      >
        {showCreate ? (
          <CreateTokenDialog
            onCreated={(token) => {
              setShowCreate(false);
              setRevealed(token);
            }}
            onCancel={() => {
              setShowCreate(false);
            }}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={revealed !== null}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
      >
        {revealed === null ? null : (
          <SecretReveal
            secret={revealed.token}
            onDone={() => {
              setRevealed(null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function TokenList({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  const locale = useLocale();
  const tokens = useMyApiTokens();
  const revoke = useRevokeMyApiToken();
  const errorMessage = useErrorMessage();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const labels = scopeLabels(t);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-muted">{t('description')}</p>
        <Button size="sm" onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t('new')}
        </Button>
      </div>
      {tokens.data === undefined ? (
        <Skeleton className="h-24" />
      ) : tokens.data.length === 0 ? (
        <EmptyState icon={<KeyRound aria-hidden="true" />} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {tokens.data.map((token) => {
            const expired = isExpired(token.expiresAt);
            return (
              <li key={token.id} className="flex flex-col gap-2 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-fg">{token.name}</p>
                      {expired ? <Badge tone="danger">{t('expired')}</Badge> : null}
                    </div>
                    <p className="truncate font-mono text-xs text-fg-muted">{token.tokenPrefix}…</p>
                    <p className="text-xs text-fg-subtle">
                      {token.scopes.map((scope) => labels[scope] ?? scope).join(', ')}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {token.expiresAt === null ? t('neverExpires') : t('expiresAt', { date: formatDateTime(token.expiresAt, locale) })}
                      {' · '}
                      {token.lastUsedAt === null ? t('neverUsed') : t('lastUsedAt', { date: formatDateTime(token.lastUsedAt, locale) })}
                    </p>
                  </div>
                  {confirmId === token.id ? null : (
                    <IconButton
                      label={t('revoke')}
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        setConfirmId(token.id);
                      }}
                    />
                  )}
                </div>
                {confirmId === token.id ? (
                  <div className="flex items-center justify-end gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
                    <span className="me-auto text-fg">{t('confirmRevoke')}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setConfirmId(null); }}>
                      {tc('cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={revoke.isPending}
                      onClick={() => {
                        revoke.mutate(token.id, {
                          onSuccess: () => { setConfirmId(null); },
                          onError: (error) => { toast.error(errorMessage(error)); },
                        });
                      }}
                    >
                      {t('confirmRevokeAction')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CreateTokenDialog({
  onCreated,
  onCancel,
}: {
  onCreated: (token: ApiTokenWithSecret) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateMyApiToken();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');

  const submit = async () => {
    if (name.trim() === '' || scopes.length === 0) {
      toast.error(t('incomplete'));
      return;
    }
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        scopes,
        expiresAt: expiresAt === '' ? null : endOfDayIso(expiresAt),
      });
      onCreated(created);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('createTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('nameLabel')} required requiredLabel={tc('required')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-fg">{t('scopesLabel')}</legend>
          <p className="mb-1 text-xs text-fg-muted">{t('scopesHint')}</p>
          {API_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={scopes.includes(scope)}
                onCheckedChange={() => {
                  setScopes((current) => toggleScope(current, scope));
                }}
              />
              {t(`scope.${scope}`)}
            </label>
          ))}
        </fieldset>
        <Field label={t('expiresOptional')} hint={t('expiresHint')}>
          <Input
            type="date"
            value={expiresAt}
            onChange={(event) => { setExpiresAt(event.target.value); }}
          />
        </Field>
      </div>
    </Modal>
  );
}

function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  return (
    <Modal
      title={t('secretTitle')}
      description={t('secretDescription')}
      closeLabel={tc('close')}
      footer={<Button onClick={onDone}>{t('done')}</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-sunken p-3">
          <p className="break-all font-mono text-xs">{secret}</p>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => {
              void navigator.clipboard.writeText(secret).then(() => {
                toast.success(tc('copied'));
              });
            }}
          >
            {tc('copy')}
          </Button>
        </div>
        <p className="text-sm text-danger">{t('secretWarning')}</p>
      </div>
    </Modal>
  );
}
