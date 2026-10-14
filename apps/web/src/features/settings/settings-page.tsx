'use client';

import { LOCALE_LABELS, LOCALES, type Locale } from '@cube-track/i18n';
import { Badge, Button, Field, Input, Select, Skeleton, toast } from '@cube-track/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { useState, type SubmitEvent, type ReactNode } from 'react';

import { FormMessage } from '@/components/common/form-error';
import { PageHeader } from '@/components/common/page-header';
import { usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api/client';
import { signOut } from '@/lib/auth/session';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import {
  updatePreferences,
  usePreferences,
  type DensityPreference,
  type ThemePreference,
} from '@/stores/preferences';

import { useMe } from '../shell/hooks';

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-surface p-5">
      <h2 id={id} className="mb-4 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PasswordForm() {
  const t = useTranslations('settings');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (next.length < 10) {
      setError(tv('passwordLength'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api('/v1/me/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      toast.success(t('passwordChanged'));
      setCurrent('');
      setNext('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex max-w-md flex-col gap-3"
      noValidate
    >
      <h3 className="text-sm font-semibold">{t('changePassword')}</h3>
      <FormMessage>{error}</FormMessage>
      <Field label={t('currentPassword')}>
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => {
            setCurrent(event.target.value);
          }}
        />
      </Field>
      <Field label={t('newPassword')} hint={tv('passwordLength')}>
        <Input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => {
            setNext(event.target.value);
          }}
        />
      </Field>
      <Button type="submit" variant="secondary" className="self-start" loading={saving}>
        {t('changePassword')}
      </Button>
    </form>
  );
}

function MfaPanel({ enabled }: { enabled: boolean }) {
  const t = useTranslations('settings.mfa');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const result = await api<{ secret: string; otpauthUri: string }>('/v1/me/mfa/setup', {
        method: 'POST',
        body: {},
      });
      setSetup({
        secret: result.secret,
        qr: await QRCode.toDataURL(result.otpauthUri, { margin: 1, width: 192 }),
      });
    });

  const confirm = (event: SubmitEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError(tv('code'));
      return;
    }
    void run(async () => {
      if (enabled) {
        await api('/v1/me/mfa/disable', { method: 'POST', body: { code } });
        toast.success(t('disabledToast'));
      } else {
        const result = await api<{ recoveryCodes: string[] }>('/v1/me/mfa/enable', {
          method: 'POST',
          body: { code },
        });
        setRecovery(result.recoveryCodes);
        setSetup(null);
        toast.success(t('enabledToast'));
      }
      setCode('');
      await queryClient.invalidateQueries({ queryKey: qk.me() });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <Badge tone={enabled ? 'success' : 'neutral'}>
          {enabled ? t('enabled') : t('disabled')}
        </Badge>
      </div>
      <FormMessage>{error}</FormMessage>
      {recovery === null ? null : (
        <div className="rounded-lg border border-warning bg-warning-soft p-3">
          <p className="text-sm font-semibold">{t('recoveryTitle')}</p>
          <p className="mb-2 text-xs text-fg-muted">{t('recoveryHint')}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
            {recovery.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
      {!enabled && setup === null ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={busy}
          onClick={() => void start()}
        >
          {t('setup')}
        </Button>
      ) : null}
      {setup !== null ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* QR code gerado localmente a partir do otpauth URI (o segredo não sai do navegador). */}
          <img
            src={setup.qr}
            alt={t('secret')}
            width={192}
            height={192}
            className="rounded-md border border-border bg-white"
          />
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-fg-muted">{t('scan')}</p>
            <p>
              {t('secret')}: <code className="break-all font-mono">{setup.secret}</code>
            </p>
          </div>
        </div>
      ) : null}
      {setup !== null || enabled ? (
        <form onSubmit={confirm} className="flex max-w-md items-end gap-2" noValidate>
          <Field label={enabled ? t('disablePassword') : t('confirm')} className="flex-1">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
            />
          </Field>
          <Button type="submit" variant={enabled ? 'danger' : 'primary'} loading={busy}>
            {enabled ? t('disable') : t('enable')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function SettingsPage() {
  const t = useTranslations('settings');
  const tu = useTranslations('shell.user');
  const me = useMe();
  const theme = usePreferences((state) => state.theme);
  const density = usePreferences((state) => state.density);
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="pb-10">
      <PageHeader title={t('title')} />
      <div className="flex max-w-3xl flex-col gap-6 px-4 sm:px-8">
        <Section title={t('profile')} id="settings-profile">
          {me.data === undefined ? (
            <Skeleton className="h-16" />
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-fg-muted">{t('nameLabel')}</dt>
                <dd className="font-medium">{me.data.user.name}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('emailLabel')}</dt>
                <dd className="font-medium">{me.data.user.email}</dd>
              </div>
            </dl>
          )}
        </Section>
        <Section title={t('preferences')} id="settings-preferences">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('theme')}>
              <Select
                value={theme}
                onValueChange={(value) => {
                  updatePreferences({ theme: value as ThemePreference });
                  toast.success(t('saved'));
                }}
                options={[
                  { value: 'light', label: tu('light') },
                  { value: 'dark', label: tu('dark') },
                  { value: 'system', label: tu('system') },
                ]}
              />
            </Field>
            <Field label={t('density')}>
              <Select
                value={density}
                onValueChange={(value) => {
                  updatePreferences({ density: value as DensityPreference });
                  toast.success(t('saved'));
                }}
                options={[
                  { value: 'comfortable', label: tu('comfortable') },
                  { value: 'compact', label: tu('compact') },
                ]}
              />
            </Field>
            <Field label={t('language')}>
              <Select
                value={locale}
                onValueChange={(value) => {
                  router.replace(pathname, { locale: value as Locale });
                }}
                options={LOCALES.map((value) => ({ value, label: LOCALE_LABELS[value] }))}
              />
            </Field>
          </div>
        </Section>
        <Section title={t('security')} id="settings-security">
          <div className="flex flex-col gap-8">
            <MfaPanel enabled={me.data?.user.mfaEnabled ?? false} />
            <PasswordForm />
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                void api('/v1/auth/logout-all', { method: 'POST', body: {} })
                  .catch(() => undefined)
                  .then(() => signOut())
                  .then(() => {
                    router.replace('/login');
                  });
              }}
            >
              {t('signOutAll')}
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
