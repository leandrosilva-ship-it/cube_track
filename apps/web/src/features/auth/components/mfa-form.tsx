'use client';

import { Button, Field, Input } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';

import { FormMessage } from '@/components/common/form-error';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { authApi } from '../api';
import { useCompleteSignIn } from '../use-complete-sign-in';

export function MfaForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const searchParams = useSearchParams();
  const challenge = searchParams.get('challenge') ?? '';
  const complete = useCompleteSignIn();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!recovery && !/^\d{6}$/.test(trimmed)) {
      setFieldError(tv('code'));
      return;
    }
    if (recovery && trimmed === '') {
      setFieldError(tv('required'));
      return;
    }
    setFieldError(null);
    setError(null);
    setSubmitting(true);
    try {
      const session = await authApi.verifyMfa(
        challenge,
        recovery ? { recoveryCode: trimmed } : { code: trimmed },
      );
      await complete(session, searchParams.get('next'));
    } catch (caught) {
      setError(
        isApiError(caught, 401) || isApiError(caught, 400)
          ? t('mfa.invalid')
          : errorMessage(caught),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t('mfa.title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('mfa.description')}</p>
      </div>
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        <FormMessage>{error}</FormMessage>
        <Field label={recovery ? t('mfa.recoveryCode') : t('mfa.code')} error={fieldError}>
          <Input
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            autoComplete="one-time-code"
            inputMode={recovery ? 'text' : 'numeric'}
            maxLength={recovery ? 32 : 6}
            className="text-center font-mono text-lg tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" size="lg" loading={submitting}>
          {t('mfa.submit')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setRecovery((current) => !current);
            setValue('');
            setFieldError(null);
          }}
        >
          {recovery ? t('mfa.useCode') : t('mfa.useRecovery')}
        </Button>
      </form>
      <Link href="/login" className="text-center text-sm font-medium text-primary hover:underline">
        {t('forgot.backToLogin')}
      </Link>
    </div>
  );
}
