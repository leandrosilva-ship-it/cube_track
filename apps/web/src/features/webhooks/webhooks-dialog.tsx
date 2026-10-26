'use client';

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Skeleton,
  Switch,
  toast,
} from '@cube-track/ui';
import { Pencil, Plug, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail, Webhook, WebhookWithSecret } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useCreateWebhook,
  useDeleteWebhook,
  useRegenerateWebhookSecret,
  useUpdateWebhook,
  useWebhooks,
} from './hooks';
import {
  headersToRows,
  rowsToHeaders,
  WEBHOOK_EVENT_TYPES,
  type HeaderRow,
  type WebhookInputBody,
} from './model';

type View =
  | { mode: 'list' }
  | { mode: 'form'; webhook?: Webhook }
  | { mode: 'secret'; webhook: WebhookWithSecret };

export function WebhooksDialog({ board }: { board: BoardDetail }) {
  const [view, setView] = useState<View>({ mode: 'list' });

  if (view.mode === 'form') {
    return (
      <WebhookForm
        board={board}
        webhook={view.webhook}
        onCreated={(webhook) => {
          setView({ mode: 'secret', webhook });
        }}
        onUpdated={() => {
          setView({ mode: 'list' });
        }}
        onCancel={() => {
          setView({ mode: 'list' });
        }}
      />
    );
  }

  if (view.mode === 'secret') {
    return (
      <SecretReveal
        webhook={view.webhook}
        onDone={() => {
          setView({ mode: 'list' });
        }}
      />
    );
  }

  return (
    <WebhooksList
      board={board}
      onCreate={() => {
        setView({ mode: 'form' });
      }}
      onEdit={(webhook) => {
        setView({ mode: 'form', webhook });
      }}
      onSecretRevealed={(webhook) => {
        setView({ mode: 'secret', webhook });
      }}
    />
  );
}

function SecretReveal({
  webhook,
  onDone,
}: {
  webhook: WebhookWithSecret;
  onDone: () => void;
}) {
  const t = useTranslations('webhooks');
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
          <p className="text-xs text-fg-muted">{t('secretLabel')}</p>
          <p className="break-all font-mono text-xs">{webhook.secret}</p>
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => {
              void navigator.clipboard.writeText(webhook.secret).then(() => {
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

function WebhooksList({
  board,
  onCreate,
  onEdit,
  onSecretRevealed,
}: {
  board: BoardDetail;
  onCreate: () => void;
  onEdit: (webhook: Webhook) => void;
  onSecretRevealed: (webhook: WebhookWithSecret) => void;
}) {
  const t = useTranslations('webhooks');
  const tc = useTranslations('common');
  const webhooks = useWebhooks(board.id);
  const update = useUpdateWebhook(board.id);
  const regenerate = useRegenerateWebhookSecret(board.id);
  const del = useDeleteWebhook(board.id);
  const errorMessage = useErrorMessage();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <Button onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t('new')}
        </Button>
      }
    >
      {webhooks.data === undefined ? (
        <Skeleton className="h-32" />
      ) : webhooks.data.length === 0 ? (
        <EmptyState
          icon={<Plug aria-hidden="true" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {webhooks.data.map((webhook) => (
            <li key={webhook.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-fg">{webhook.name}</p>
                    {webhook.isEnabled ? null : <Badge tone="neutral">{t('disabled')}</Badge>}
                    {webhook.consecutiveFailures > 0 && webhook.isEnabled ? (
                      <Badge tone="warning">
                        {t('consecutiveFailures', { count: webhook.consecutiveFailures })}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="truncate font-mono text-xs text-fg-muted">{webhook.url}</p>
                  <p className="truncate text-xs text-fg-subtle">
                    {t('eventsCount', { count: webhook.events.length })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    aria-label={webhook.isEnabled ? t('enabled') : t('disabled')}
                    checked={webhook.isEnabled}
                    onCheckedChange={(checked) => {
                      update.mutate({ id: webhook.id, input: { isEnabled: checked } });
                    }}
                  />
                  <IconButton
                    label={t('edit')}
                    icon={<Pencil aria-hidden="true" />}
                    size="icon-sm"
                    onClick={() => {
                      onEdit(webhook);
                    }}
                  />
                  <IconButton
                    label={t('regenerateSecret')}
                    icon={<RefreshCw aria-hidden="true" />}
                    size="icon-sm"
                    onClick={() => {
                      regenerate.mutate(webhook.id, {
                        onSuccess: onSecretRevealed,
                        onError: (error) => {
                          toast.error(errorMessage(error));
                        },
                      });
                    }}
                  />
                  {confirmDeleteId === webhook.id ? null : (
                    <IconButton
                      label={t('delete')}
                      icon={<Trash2 aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        setConfirmDeleteId(webhook.id);
                      }}
                    />
                  )}
                </div>
              </div>
              {confirmDeleteId === webhook.id ? (
                <div className="flex items-center justify-end gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
                  <span className="me-auto text-fg">{t('confirmDelete')}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setConfirmDeleteId(null);
                    }}
                  >
                    {tc('cancel')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={del.isPending}
                    onClick={() => {
                      del.mutate(webhook.id, {
                        onSuccess: () => {
                          setConfirmDeleteId(null);
                        },
                        onError: (error) => {
                          toast.error(errorMessage(error));
                        },
                      });
                    }}
                  >
                    {t('confirmDeleteAction')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function WebhookForm({
  board,
  webhook,
  onCreated,
  onUpdated,
  onCancel,
}: {
  board: BoardDetail;
  webhook?: Webhook | undefined;
  onCreated: (webhook: WebhookWithSecret) => void;
  onUpdated: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('webhooks');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateWebhook(board.id);
  const update = useUpdateWebhook(board.id);
  const isEdit = webhook !== undefined;

  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? 'https://');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(
    headersToRows(webhook?.headers ?? {}),
  );
  const [isEnabled, setIsEnabled] = useState(webhook?.isEnabled ?? true);

  const submit = async () => {
    if (name.trim() === '' || !url.startsWith('https://') || events.length === 0) {
      toast.error(t('incomplete'));
      return;
    }
    const body: WebhookInputBody = {
      name: name.trim(),
      url: url.trim(),
      events,
      headers: rowsToHeaders(headerRows),
      isEnabled,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: webhook.id, input: body });
        onUpdated();
      } else {
        const created = await create.mutateAsync(body);
        onCreated(created);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('editTitle') : t('createTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button
            loading={create.isPending || update.isPending}
            onClick={() => {
              void submit();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('name')} required requiredLabel={tc('required')}>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label={t('url')} required requiredLabel={tc('required')} hint={t('urlHint')}>
          <Input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-fg">{t('events')}</legend>
          {WEBHOOK_EVENT_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={events.includes(type)}
                onCheckedChange={(checked) => {
                  setEvents((current) =>
                    checked === true ? [...current, type] : current.filter((entry) => entry !== type),
                  );
                }}
              />
              {t(`eventType.${type}`)}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">{t('headers')}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setHeaderRows((rows) => [...rows, { key: '', value: '' }]);
              }}
            >
              <Plus aria-hidden="true" />
              {t('addHeader')}
            </Button>
          </div>
          {headerRows.map((row, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="flex-1"
                placeholder={t('headerKey')}
                value={row.key}
                onChange={(event) => {
                  const value = event.target.value;
                  setHeaderRows((rows) =>
                    rows.map((entry, i) => (i === index ? { ...entry, key: value } : entry)),
                  );
                }}
              />
              <Input
                className="flex-1"
                placeholder={t('headerValue')}
                value={row.value}
                onChange={(event) => {
                  const value = event.target.value;
                  setHeaderRows((rows) =>
                    rows.map((entry, i) => (i === index ? { ...entry, value } : entry)),
                  );
                }}
              />
              <IconButton
                label={t('removeRow')}
                icon={<X aria-hidden="true" />}
                size="icon-sm"
                onClick={() => {
                  setHeaderRows((rows) => rows.filter((_, i) => i !== index));
                }}
              />
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label={t('enabledField')} />
          {t('enabledField')}
        </label>
      </div>
    </Modal>
  );
}
