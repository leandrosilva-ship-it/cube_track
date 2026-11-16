'use client';

import { Button, Field, Input, Skeleton, Switch, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { EmailSettings } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useEmailSettings, useSendTestEmail, useUpdateEmailSettings } from './hooks';

/** Seção "E-mail (SMTP)" das configurações da organização — visível só com `email.manage`
 * (TENANT). A senha é write-only: `hasPassword` é o único sinal de que há uma configurada; o
 * campo nunca é pré-preenchido com o valor real. Sem configuração própria (ou desabilitada), a
 * organização usa o SMTP padrão da plataforma — isso nunca trava o envio de e-mails. */
export function EmailSettingsSection() {
  const settings = useEmailSettings();

  if (settings.data === undefined) return <Skeleton className="h-64" />;

  return <EmailSettingsForm key={settings.data.updatedAt ?? 'new'} settings={settings.data} />;
}

function EmailSettingsForm({ settings }: { settings: EmailSettings }) {
  const t = useTranslations('settings.email');
  const errorMessage = useErrorMessage();
  const update = useUpdateEmailSettings();
  const sendTest = useSendTestEmail();

  const [enabled, setEnabled] = useState(settings.enabled);
  const [host, setHost] = useState(settings.host ?? '');
  const [port, setPort] = useState(settings.port?.toString() ?? '465');
  const [secure, setSecure] = useState(settings.secure);
  const [username, setUsername] = useState(settings.username ?? '');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState(settings.fromAddress ?? '');

  const showEnableWarning = enabled && !settings.enabled;

  const save = async () => {
    try {
      await update.mutateAsync({
        enabled,
        host: host.trim(),
        port: Number(port),
        secure,
        username: username.trim() === '' ? null : username.trim(),
        ...(password.trim() === '' ? {} : { password: password.trim() }),
        fromAddress: fromAddress.trim() === '' ? null : fromAddress.trim(),
      });
      setPassword('');
      toast.success(t('saved'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const test = async () => {
    try {
      await sendTest.mutateAsync();
      toast.success(t('testSent'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('enabledLabel')} />
        {t('enabledLabel')}
      </label>
      {showEnableWarning ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{t('enabledOnWarning')}</p>
      ) : null}
      {!settings.enabled && !showEnableWarning ? (
        <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-fg-muted">{t('disabledWarning')}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label={t('hostLabel')} hint={t('hostHint')}>
          <Input
            value={host}
            placeholder="smtp.resend.com"
            onChange={(event) => {
              setHost(event.target.value);
            }}
          />
        </Field>
        <Field label={t('portLabel')}>
          <Input
            type="number"
            min={1}
            max={65535}
            className="w-24"
            value={port}
            onChange={(event) => {
              setPort(event.target.value);
            }}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Switch checked={secure} onCheckedChange={setSecure} aria-label={t('secureLabel')} />
        {t('secureLabel')}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('usernameLabel')}>
          <Input
            value={username}
            autoComplete="off"
            onChange={(event) => {
              setUsername(event.target.value);
            }}
          />
        </Field>
        <Field label={t('passwordLabel')} hint={t('passwordHint')}>
          <Input
            type="password"
            autoComplete="off"
            value={password}
            placeholder={settings.hasPassword ? t('passwordSetPlaceholder') : t('passwordUnsetPlaceholder')}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
      </div>

      <Field label={t('fromAddressLabel')} hint={t('fromAddressHint')}>
        <Input
          value={fromAddress}
          placeholder="CUBE PROJECT <nao-responda@seudominio.com.br>"
          onChange={(event) => {
            setFromAddress(event.target.value);
          }}
        />
      </Field>

      <div className="flex gap-2">
        <Button loading={update.isPending} onClick={() => void save()}>
          {t('save')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={sendTest.isPending}
          disabled={!settings.enabled}
          onClick={() => void test()}
        >
          {t('sendTest')}
        </Button>
      </div>
    </div>
  );
}
