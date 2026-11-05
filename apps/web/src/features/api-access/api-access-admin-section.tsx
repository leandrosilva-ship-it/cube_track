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
  Switch,
  Textarea,
  toast,
} from '@cube-track/ui';
import { BookOpen, KeyRound, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { OAuthApp, OAuthAppWithSecret } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useAllApiTokens,
  useCreateOAuthApp,
  useDeleteOAuthApp,
  useOAuthApps,
  useRevokeAnyApiToken,
  useUpdateOAuthApp,
} from './hooks';
import { API_SCOPES, isExpired, toggleScope } from './model';

type ApiAccessTranslator = ReturnType<typeof useTranslations<'apiAccess'>>;

/** Mapa escopo → rótulo traduzido (ver `api-tokens-section.tsx` para o motivo de não usar
 * `t(`scope.${scope}`)` direto com uma `scope: string` solta). */
function scopeLabels(t: ApiAccessTranslator): Record<string, string> {
  return Object.fromEntries(API_SCOPES.map((scope) => [scope, t(`scope.${scope}`)]));
}

/**
 * Administração de API do tenant (ADR 0056) — requer `api_tokens.manage`: tokens de QUALQUER
 * usuário, CRUD de apps OAuth (`client_credentials`) e o link para a documentação (Swagger).
 */
export function ApiAccessAdminSection() {
  return (
    <div className="flex flex-col gap-8">
      <AllTokensList />
      <OAuthAppsSection />
      <DocsLink />
    </div>
  );
}

function AllTokensList() {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  const locale = useLocale();
  const tokens = useAllApiTokens();
  const revoke = useRevokeAnyApiToken();
  const errorMessage = useErrorMessage();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const labels = scopeLabels(t);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-fg">{t('allTokensTitle')}</h3>
      {tokens.data === undefined ? (
        <Skeleton className="h-24" />
      ) : tokens.data.length === 0 ? (
        <EmptyState icon={<KeyRound aria-hidden="true" />} title={t('emptyTitle')} />
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
                      {token.oauthAppId !== null ? <Badge tone="info">{t('oauthAppsTitle')}</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-fg-muted">
                      {token.userName ?? t('userColumn')} · <span className="font-mono">{token.tokenPrefix}…</span>
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {token.scopes.map((scope) => labels[scope] ?? scope).join(', ')}
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {token.lastUsedAt === null ? t('neverUsed') : t('lastUsedAt', { date: formatDateTime(token.lastUsedAt, locale) })}
                    </p>
                  </div>
                  {confirmId === token.id ? null : (
                    <IconButton
                      label={t('revoke')}
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => { setConfirmId(token.id); }}
                    />
                  )}
                </div>
                {confirmId === token.id ? (
                  <div className="flex items-center justify-end gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
                    <span className="me-auto text-fg">{t('confirmRevoke')}</span>
                    <Button variant="ghost" size="sm" onClick={() => { setConfirmId(null); }}>{tc('cancel')}</Button>
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
    </section>
  );
}

type AppView = { mode: 'list' } | { mode: 'form'; app?: OAuthApp } | { mode: 'secret'; app: OAuthAppWithSecret };

function OAuthAppsSection() {
  const [view, setView] = useState<AppView>({ mode: 'list' });
  const t = useTranslations('apiAccess');

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{t('oauthAppsTitle')}</h3>
        <Button size="sm" variant="secondary" onClick={() => { setView({ mode: 'form' }); }}>
          <Plus aria-hidden="true" />
          {t('newApp')}
        </Button>
      </div>
      <p className="text-sm text-fg-muted">{t('oauthAppsDescription')}</p>
      <OAuthAppsList
        onEdit={(app) => { setView({ mode: 'form', app }); }}
      />
      <Dialog
        open={view.mode !== 'list'}
        onOpenChange={(open) => {
          if (!open) setView({ mode: 'list' });
        }}
      >
        {view.mode === 'form' ? (
          <OAuthAppForm
            app={view.app}
            onCreated={(app) => { setView({ mode: 'secret', app }); }}
            onUpdated={() => { setView({ mode: 'list' }); }}
            onCancel={() => { setView({ mode: 'list' }); }}
          />
        ) : null}
        {view.mode === 'secret' ? (
          <OAuthSecretReveal secret={view.app.clientSecret} onDone={() => { setView({ mode: 'list' }); }} />
        ) : null}
      </Dialog>
    </section>
  );
}

function OAuthAppsList({ onEdit }: { onEdit: (app: OAuthApp) => void }) {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  const apps = useOAuthApps();
  const update = useUpdateOAuthApp();
  const del = useDeleteOAuthApp();
  const errorMessage = useErrorMessage();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const labels = scopeLabels(t);

  if (apps.data === undefined) return <Skeleton className="h-24" />;
  if (apps.data.length === 0) return <EmptyState icon={<Plug aria-hidden="true" />} title={t('oauthAppsEmpty')} />;

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {apps.data.map((app) => (
        <li key={app.id} className="flex flex-col gap-2 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium text-fg">{app.name}</p>
                {app.isActive ? null : <Badge tone="neutral">{t('appInactive')}</Badge>}
              </div>
              <p className="truncate font-mono text-xs text-fg-muted">{app.clientId}</p>
              <p className="text-xs text-fg-subtle">{app.scopes.map((scope) => labels[scope] ?? scope).join(', ')}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Switch
                aria-label={app.isActive ? t('appInactive') : t('appActive')}
                checked={app.isActive}
                onCheckedChange={(checked) => {
                  update.mutate({ id: app.id, input: { isActive: checked } });
                }}
              />
              <IconButton label={t('editApp')} icon={<Pencil aria-hidden="true" />} size="icon-sm" onClick={() => { onEdit(app); }} />
              {confirmId === app.id ? null : (
                <IconButton
                  label={t('deleteApp')}
                  icon={<Trash2 aria-hidden="true" />}
                  size="icon-sm"
                  onClick={() => { setConfirmId(app.id); }}
                />
              )}
            </div>
          </div>
          {confirmId === app.id ? (
            <div className="flex items-center justify-end gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
              <span className="me-auto text-fg">{t('confirmDeleteApp')}</span>
              <Button variant="ghost" size="sm" onClick={() => { setConfirmId(null); }}>{tc('cancel')}</Button>
              <Button
                variant="danger"
                size="sm"
                loading={del.isPending}
                onClick={() => {
                  del.mutate(app.id, {
                    onSuccess: () => { setConfirmId(null); },
                    onError: (error) => { toast.error(errorMessage(error)); },
                  });
                }}
              >
                {t('confirmDeleteAppAction')}
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OAuthAppForm({
  app,
  onCreated,
  onUpdated,
  onCancel,
}: {
  app?: OAuthApp | undefined;
  onCreated: (app: OAuthAppWithSecret) => void;
  onUpdated: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateOAuthApp();
  const update = useUpdateOAuthApp();
  const isEdit = app !== undefined;

  const [name, setName] = useState(app?.name ?? '');
  const [description, setDescription] = useState(app?.description ?? '');
  const [scopes, setScopes] = useState<string[]>(app?.scopes ?? []);

  const submit = async () => {
    if (name.trim() === '' || scopes.length === 0) {
      toast.error(t('incomplete'));
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: app.id,
          input: { name: name.trim(), description: description.trim() === '' ? null : description.trim(), scopes },
        });
        onUpdated();
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          ...(description.trim() === '' ? {} : { description: description.trim() }),
          scopes,
        });
        onCreated(created);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('editAppTitle') : t('newAppTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
          <Button loading={create.isPending || update.isPending} onClick={() => void submit()}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('appNameLabel')} required requiredLabel={tc('required')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('appDescriptionLabel')}>
          <Textarea rows={2} value={description} onChange={(event) => { setDescription(event.target.value); }} />
        </Field>
        <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-fg">{t('scopesLabel')}</legend>
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
      </div>
    </Modal>
  );
}

function OAuthSecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useTranslations('apiAccess');
  const tc = useTranslations('common');
  return (
    <Modal
      title={t('clientSecretTitle')}
      description={t('clientSecretDescription')}
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
              void navigator.clipboard.writeText(secret).then(() => { toast.success(tc('copied')); });
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

function DocsLink() {
  const t = useTranslations('apiAccess');
  return (
    <section className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{t('docsTitle')}</h3>
        <p className="text-sm text-fg-muted">{t('docsDescription')}</p>
      </div>
      <Button asChild variant="secondary" size="sm">
        <a href="/v1/docs" target="_blank" rel="noopener noreferrer">
          <BookOpen aria-hidden="true" />
          {t('openDocs')}
        </a>
      </Button>
    </section>
  );
}
