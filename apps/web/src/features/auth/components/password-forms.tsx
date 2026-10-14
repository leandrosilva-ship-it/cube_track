'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod/mini';

import { FormMessage } from '@/components/common/form-error';
import { Link } from '@/i18n/navigation';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { authApi } from '../api';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = z.object({ email: z.email(tv('email')) });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });
  const submit = form.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t('forgot.title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('forgot.description')}</p>
      </div>
      {sent ? (
        <FormMessage tone="success">{t('forgot.sent')}</FormMessage>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormMessage>{error}</FormMessage>
          <Field label={t('email')} error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
            {t('forgot.submit')}
          </Button>
        </form>
      )}
      <Link href="/login" className="text-center text-sm font-medium text-primary hover:underline">
        {t('forgot.backToLogin')}
      </Link>
    </div>
  );
}

export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const tv = useTranslations('validation');
  const errorMessage = useErrorMessage();
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = z
    .object({
      password: z.string().check(z.minLength(10, tv('passwordLength'))),
      confirm: z.string(),
    })
    .check(
      z.refine((value) => value.password === value.confirm, {
        path: ['confirm'],
        message: tv('passwordMismatch'),
      }),
    );
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });
  const submit = form.handleSubmit(async ({ password }) => {
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (caught) {
      setError(
        isApiError(caught, 400) || isApiError(caught, 401)
          ? t('reset.invalidToken')
          : errorMessage(caught),
      );
    }
  });
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">{t('reset.title')}</h1>
      {done ? (
        <>
          <FormMessage tone="success">{t('reset.done')}</FormMessage>
          <Button asChild size="lg">
            <Link href="/login">{t('login.submit')}</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <FormMessage>{token === '' ? t('reset.invalidToken') : error}</FormMessage>
          <Field
            label={t('reset.password')}
            error={form.formState.errors.password?.message}
            hint={tv('passwordLength')}
          >
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label={t('reset.confirm')} error={form.formState.errors.confirm?.message}>
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button
            type="submit"
            size="lg"
            loading={form.formState.isSubmitting}
            disabled={token === ''}
          >
            {t('reset.submit')}
          </Button>
        </form>
      )}
    </div>
  );
}
